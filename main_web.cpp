#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

#include <emscripten.h>
#include <emscripten/webaudio.h>
#include <emscripten/em_math.h>

#define GL_GLEXT_PROTOTYPES
#define EGL_EGLEXT_PROTOTYPES
#include <GLES2/gl2.h>
#include <EGL/egl.h>

#include "imgui.h"
#include "imgui_impl_opengl3.h"

static bool show_demo_window = true;


EM_JS(int, canvas_get_width, (void), {
	const e = document.getElementById("canvas");
	const v = e.width = e.offsetWidth;
	return v;
})

EM_JS(int, canvas_get_height, (void), {
	const e = document.getElementById("canvas");
	const v = e.height = e.offsetHeight;
	return v;
})

static const char* current_canvas_cursor = NULL;
EM_JS(void, set_canvas_cursor, (const char* cursor), {
	document.getElementById("canvas").setAttribute("style", "cursor:" + UTF8ToString(cursor) + ";");
})

static double last_time;
static void main_loop(void)
{
	const int canvas_width = canvas_get_width();
	const int canvas_height = canvas_get_height();

	ImGuiIO& io = ImGui::GetIO();
	io.DisplaySize = ImVec2((float)canvas_width, (float)canvas_height);

	const double now = emscripten_get_now() * 1e-3;
	if (last_time > 0) io.DeltaTime = now - last_time;
	last_time = now;

	ImGui_ImplOpenGL3_NewFrame();
	ImGui::NewFrame();

	if (show_demo_window) {
		ImGui::ShowDemoWindow(&show_demo_window);
	}

	{
		const char* cursor = "default";
		switch (ImGui::GetMouseCursor()) {
		case ImGuiMouseCursor_Arrow:       cursor = "default"      ; break ;
		case ImGuiMouseCursor_TextInput:   cursor = "text"         ; break ;
		case ImGuiMouseCursor_ResizeAll:   cursor = "alt-scroll"   ; break ;
		case ImGuiMouseCursor_ResizeNS:    cursor = "ns-resize"    ; break ;
		case ImGuiMouseCursor_ResizeEW:    cursor = "ew-resize"    ; break ;
		case ImGuiMouseCursor_ResizeNESW:  cursor = "nesw-resize"  ; break ;
		case ImGuiMouseCursor_ResizeNWSE:  cursor = "nwse-resize"  ; break ;
		case ImGuiMouseCursor_Hand:        cursor = "grab"         ; break ;
		}
		if (cursor != current_canvas_cursor) {
			set_canvas_cursor(cursor);
			current_canvas_cursor = cursor;
		}
	}

	ImGui::Render();
	glViewport(0, 0, canvas_width, canvas_height);
	const ImVec4 clear_color = ImVec4(0.05f, 0.25f, 0.00f, 1.00f);
	glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w, clear_color.z * clear_color.w, clear_color.w);
	glClear(GL_COLOR_BUFFER_BIT);
	ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

uint8_t audio_thread_stack[1<<12];


bool GenerateNoise(int numInputs, const AudioSampleFrame *inputs, int numOutputs, AudioSampleFrame *outputs, int numParams, const AudioParamFrame *params, void *userData)
{
	const float mag = 0.002f; // subtle
	for (int i = 0; i < numOutputs; ++i) {
		for (int j = 0; j < outputs[i].samplesPerChannel*outputs[i].numberOfChannels; ++j) {
			outputs[i].data[j] = emscripten_random() * mag - 0.5f*mag;
		}
	}
	return true; // Keep the graph output going
}

bool OnCanvasClick(int eventType, const EmscriptenMouseEvent *mouseEvent, void *userData)
{
	EMSCRIPTEN_WEBAUDIO_T audioContext = (EMSCRIPTEN_WEBAUDIO_T)userData;
	if (emscripten_audio_context_state(audioContext) != AUDIO_CONTEXT_STATE_RUNNING) {
		emscripten_resume_audio_context_sync(audioContext);
	}
	return false;
}

void AudioWorkletProcessorCreated(EMSCRIPTEN_WEBAUDIO_T audioContext, bool success, void *userData)
{
	if (!success) return; // Check browser console in a debug build for detailed errors

	int outputChannelCounts[1] = { 1 };
	EmscriptenAudioWorkletNodeCreateOptions options = {
		.numberOfInputs = 0,
		.numberOfOutputs = 1,
		.outputChannelCounts = outputChannelCounts
	};

	// Create node
	EMSCRIPTEN_AUDIO_WORKLET_NODE_T wasmAudioWorklet = emscripten_create_wasm_audio_worklet_node(audioContext,
			"noise-generator", &options, &GenerateNoise, 0);

	// Connect it to audio context destination
	emscripten_audio_node_connect(wasmAudioWorklet, audioContext, 0, 0);

	// Resume context on mouse click
	emscripten_set_click_callback("canvas", (void*)audioContext, 0, OnCanvasClick);
}

void AudioThreadInitialized(EMSCRIPTEN_WEBAUDIO_T audioContext, bool success, void *userData)
{
	if (!success) return; // Check browser console in a debug build for detailed errors
	WebAudioWorkletProcessorCreateOptions opts = {
		.name = "noise-generator",
	};
	emscripten_create_wasm_audio_worklet_processor_async(audioContext, &opts, &AudioWorkletProcessorCreated, 0);
}

static int prev_buttons, prev_mx, prev_my;

static bool handle_mouse_event(int type, const EmscriptenMouseEvent* ev, void* usr)
{
	ImGuiIO& io = ImGui::GetIO();
	{
		const int buttons = ev->buttons;
		for (int b = 0; b < 3; b++) {
			const int m = 1<<b;
			if ((buttons&m) == (prev_buttons&m)) continue;
			const bool down = (buttons&m) > 0;
			io.AddMouseButtonEvent(b, down);
		}
		prev_buttons = buttons;
	}

	{
		const int mx = ev->targetX;
		const int my = ev->targetY;
		if (mx != prev_mx || my != prev_my) {
			io.AddMousePosEvent(mx, my);
			prev_mx = mx;
			prev_my = my;
		}
	}

	return true;
}

static inline float fsign(double v)
{
	return v < 0 ? -1 : v > 0 ? 1 : 0;
}

static bool handle_wheel_event(int type, const EmscriptenWheelEvent* ev, void* usr)
{
	ImGuiIO& io = ImGui::GetIO();
	io.AddMouseWheelEvent(fsign(ev->deltaX), fsign(-ev->deltaY));
	return true;
}

static bool key_states[1<<10];

static int utf8_strlen(const char* str)
{
	const size_t rawlen = strlen(str);
	int utf8len = 0;
	for (int i = 0; i < rawlen; i++) {
		// 0xxxxxxx: 1-byte utf-8 char
		// 11xxxxxx: first byte in 2+-byte utf-8 char
		// 10xxxxxx: non-first byte in 2+-byte utf-8 char
		const uint8_t b = (uint8_t)str[i];
		if ((b&0x80)==0 || (b&0xc0)==0xc0) {
			utf8len++;
		}
	}
	return utf8len;
}

static bool handle_key_event(int type, const EmscriptenKeyboardEvent* ev, void* usr)
{
	//printf("KEY %s code=%s type=%d\n", ev->key, ev->code, type);

	const bool down = (type == EMSCRIPTEN_EVENT_KEYDOWN);
	ImGuiIO& io = ImGui::GetIO();
	if (down && utf8_strlen(ev->key) == 1) {
		io.AddInputCharactersUTF8(ev->key);
	}
	int i = 0;

	#define K(JSNAME,IMNAME) { \
		assert(i < (sizeof(key_states) / sizeof(key_states[0]))); \
		if (strcmp(ev->code, #JSNAME) == 0) { \
			if (key_states[i] != down) { \
				/* printf("KEY EVENT %s %s\n", #IMNAME, down?"down":"up"); */ \
				io.AddKeyEvent(IMNAME, down); \
				key_states[i] = down; \
			} \
		} \
		i++; \
	}

	K( Escape    , ImGuiKey_Escape    )
	K( Equal     , ImGuiKey_Equal     )
	K( Backspace , ImGuiKey_Backspace )
	K( Tab       , ImGuiKey_Tab       )

	K( BracketLeft  , ImGuiKey_LeftBracket   )
	K( BracketRight , ImGuiKey_RightBracket  )

	K( Enter           , ImGuiKey_Enter         )
	K( Semicolon       , ImGuiKey_Semicolon     )
	K( Quote           , ImGuiKey_Apostrophe    )
	K( Backquote       , ImGuiKey_GraveAccent   )
	K( Backslash       , ImGuiKey_Backslash     )
	K( Period          , ImGuiKey_Period        )
	K( Slash           , ImGuiKey_Slash         )

	K( Space           , ImGuiKey_Space                  )

	K( F1              , ImGuiKey_F1  )
	K( F2              , ImGuiKey_F2  )
	K( F3              , ImGuiKey_F3  )
	K( F4              , ImGuiKey_F4  )
	K( F5              , ImGuiKey_F5  )
	K( F6              , ImGuiKey_F6  )
	K( F7              , ImGuiKey_F7  )
	K( F8              , ImGuiKey_F8  )
	K( F9              , ImGuiKey_F9  )
	K( F10             , ImGuiKey_F10 )
	K( F11             , ImGuiKey_F11 )
	K( F12             , ImGuiKey_F12 )
	K( F13             , ImGuiKey_F13 )
	K( F14             , ImGuiKey_F14 )
	K( F15             , ImGuiKey_F15 )
	K( F16             , ImGuiKey_F16 )
	K( F17             , ImGuiKey_F17 )
	K( F18             , ImGuiKey_F18 )
	K( F19             , ImGuiKey_F19 )
	K( F20             , ImGuiKey_F20 )
	K( F21             , ImGuiKey_F21 )
	K( F22             , ImGuiKey_F22 )
	K( F23             , ImGuiKey_F23 )
	K( F24             , ImGuiKey_F24 )

	K( Numpad0              , ImGuiKey_Keypad0  )
	K( Numpad1              , ImGuiKey_Keypad1  )
	K( Numpad2              , ImGuiKey_Keypad2  )
	K( Numpad3              , ImGuiKey_Keypad3  )
	K( Numpad4              , ImGuiKey_Keypad4  )
	K( Numpad5              , ImGuiKey_Keypad5  )
	K( Numpad6              , ImGuiKey_Keypad6  )
	K( Numpad7              , ImGuiKey_Keypad7  )
	K( Numpad8              , ImGuiKey_Keypad8  )
	K( Numpad9              , ImGuiKey_Keypad9  )

	K( NumpadDecimal        , ImGuiKey_KeypadDecimal )
	K( NumpadEqual          , ImGuiKey_KeypadEqual   )

	K( NumpadMultiply  , ImGuiKey_KeypadMultiply         )
	K( NumpadDivide    , ImGuiKey_KeypadDivide           )
	K( NumpadAdd       , ImGuiKey_KeypadAdd              )
	K( NumpadSubtract  , ImGuiKey_KeypadSubtract         )

	K( Home            , ImGuiKey_Home                   )
	K( End             , ImGuiKey_End                    )
	K( Insert          , ImGuiKey_Insert                 )
	K( Delete          , ImGuiKey_Delete                 )

	K( ArrowUp         , ImGuiKey_UpArrow         )
	K( ArrowDown       , ImGuiKey_DownArrow       )
	K( ArrowLeft       , ImGuiKey_LeftArrow       )
	K( ArrowRight      , ImGuiKey_RightArrow      )

	K( Digit0    , ImGuiKey_0    )
	K( Digit1    , ImGuiKey_1    )
	K( Digit2    , ImGuiKey_2    )
	K( Digit3    , ImGuiKey_3    )
	K( Digit4    , ImGuiKey_4    )
	K( Digit5    , ImGuiKey_5    )
	K( Digit6    , ImGuiKey_6    )
	K( Digit7    , ImGuiKey_7    )
	K( Digit8    , ImGuiKey_8    )
	K( Digit9    , ImGuiKey_9    )

	K( KeyA      , ImGuiKey_A    )
	K( KeyB      , ImGuiKey_B    )
	K( KeyC      , ImGuiKey_C    )
	K( KeyD      , ImGuiKey_D    )
	K( KeyE      , ImGuiKey_E    )
	K( KeyF      , ImGuiKey_F    )
	K( KeyG      , ImGuiKey_G    )
	K( KeyH      , ImGuiKey_H    )
	K( KeyI      , ImGuiKey_I    )
	K( KeyJ      , ImGuiKey_J    )
	K( KeyK      , ImGuiKey_K    )
	K( KeyL      , ImGuiKey_L    )
	K( KeyM      , ImGuiKey_M    )
	K( KeyN      , ImGuiKey_N    )
	K( KeyO      , ImGuiKey_O    )
	K( KeyP      , ImGuiKey_P    )
	K( KeyQ      , ImGuiKey_Q    )
	K( KeyR      , ImGuiKey_R    )
	K( KeyS      , ImGuiKey_S    )
	K( KeyT      , ImGuiKey_T    )
	K( KeyU      , ImGuiKey_U    )
	K( KeyV      , ImGuiKey_V    )
	K( KeyW      , ImGuiKey_W    )
	K( KeyX      , ImGuiKey_X    )
	K( KeyY      , ImGuiKey_Y    )
	K( KeyZ      , ImGuiKey_Z    )

	K( ShiftLeft , ImGuiKey_LeftShift )
	K( ShiftRight , ImGuiKey_RightShift )
	K( AltLeft , ImGuiKey_LeftAlt )
	K( AltRight , ImGuiKey_RightAlt )
	K( ControlLeft , ImGuiKey_LeftCtrl )
	K( ControlRight , ImGuiKey_RightCtrl )

	// XXX can give problems, but was easier to write? :)
	K( ShiftLeft , ImGuiMod_Shift )
	K( ShiftRight , ImGuiMod_Shift )
	K( AltLeft , ImGuiMod_Alt )
	K( AltRight , ImGuiMod_Alt )
	K( ControlLeft , ImGuiMod_Ctrl )
	K( ControlRight , ImGuiMod_Ctrl )

	#undef K

	return false;
}

EM_JS(int, is_apple_john, (void), {
	return (navigator.platform.indexOf("Mac") === 0 || navigator.platform === "iPhone") ? 1 : 0;
})

EM_JS(void, get_clipboard_text_0, (char* base, size_t limit), {
	stringToUTF8(Module["pasted_text"], base, limit);
})

static char clipboard[1<<16];
static const char* get_clipboard_text(ImGuiContext* ctx)
{
	get_clipboard_text_0(clipboard, sizeof clipboard);
	return clipboard;
}

EM_JS(void, set_clipboard_text, (ImGuiContext* ctx, const char* s), {
	const ss = UTF8ToString(s);
	Module["pasted_text"] = ss;
	navigator.clipboard.writeText(ss).then(() => {
		//console.log("updated clipboard to: " + ss);
	});
})

int main(int argc, char** argv)
{
	EMSCRIPTEN_WEBAUDIO_T context = emscripten_create_audio_context(0);
	emscripten_start_wasm_audio_worklet_thread_async(context, audio_thread_stack, sizeof(audio_thread_stack), &AudioThreadInitialized, 0);

	IMGUI_CHECKVERSION();
	ImGui::CreateContext();
	ImGuiIO& io = ImGui::GetIO();
	io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

	io.ConfigMacOSXBehaviors = is_apple_john();

	ImGui::StyleColorsDark();

	ImGui_ImplOpenGL3_Init("#version 100");

	{
		const char* id = "canvas";
		emscripten_set_mousedown_callback(id, NULL, false, handle_mouse_event);
		emscripten_set_mouseup_callback(id, NULL, false, handle_mouse_event);
		emscripten_set_mousemove_callback(id, NULL, false, handle_mouse_event);
		emscripten_set_wheel_callback(id, NULL, false, handle_wheel_event);

		const char* id2 = EMSCRIPTEN_EVENT_TARGET_WINDOW;
		emscripten_set_keydown_callback(id2, NULL, false, handle_key_event);
		emscripten_set_keyup_callback(id2, NULL, false, handle_key_event);
	}

	ImGuiPlatformIO&  pio = ImGui::GetPlatformIO();
	pio.Platform_GetClipboardTextFn = get_clipboard_text;
	pio.Platform_SetClipboardTextFn = set_clipboard_text;
	//const char* (*Platform_GetClipboardTextFn)(ImGuiContext* ctx);
	//void        (*Platform_SetClipboardTextFn)(ImGuiContext* ctx, const char* text);

	emscripten_set_main_loop(main_loop, 0, false);

	return EXIT_SUCCESS;
}
