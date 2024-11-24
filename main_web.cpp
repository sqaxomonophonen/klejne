#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

#include <emscripten.h>
#include <emscripten/webaudio.h>
#include <emscripten/wasm_worker.h>
#include <emscripten/em_math.h>

#include <atomic>

#define GL_GLEXT_PROTOTYPES
#define EGL_EGLEXT_PROTOTYPES
#include <GLES2/gl2.h>
#include <EGL/egl.h>

#include "imgui.h"
#include "imgui_impl_opengl3.h"

#include "klejne.h"

static std::atomic_int32_t ga_num_process_calls = 0;
static std::atomic_int32_t ga_testtone_lvl1e3 = 0;

static bool g_audio_resume_on_click_attempted = false;
static int g_sample_rate;
static int g_num_cores;

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

void window_audio(bool* open)
{
	const int32_t n_process_calls = ga_num_process_calls.load(std::memory_order_acquire);
	const bool is_audio_running = n_process_calls > 0;
	float testtone_lvl = (float)ga_testtone_lvl1e3.load(std::memory_order_acquire) * 1e-3;
	const float orig_testtone_lvl = testtone_lvl;

	ImGui::Begin("Web Audio", open);
	ImGui::Text("Audio status: %s", is_audio_running ? "running" : g_audio_resume_on_click_attempted ? "did not start (error?)" : "not started (click anywhere in window)");
	if (n_process_calls > 0) {
		ImGui::SetItemTooltip("Number of process calls: %d", n_process_calls);
	}

	if (is_audio_running) {
		ImGui::Text("Sample rate: %d Hz", g_sample_rate);
		ImGui::SliderFloat("Test tone (440 Hz)", &testtone_lvl, 0.0f, 1.0f);
	}

	ImGui::End();

	if (testtone_lvl != orig_testtone_lvl) {
		ga_testtone_lvl1e3.store((int32_t)(testtone_lvl*1e3f), std::memory_order_release);
	}
}

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

	window_root();

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

static int32_t g_current_testtone_lvl1e3;
static float g_testtone_phase;
bool audio_worklet_process(int n_inputs, const AudioSampleFrame* inputs, int n_outputs, AudioSampleFrame* outputs, int n_params, const AudioParamFrame* params, void* usr)
{
	//printf("audio master/worklet id: %u\n", emscripten_wasm_worker_self_id());
	const int32_t target_testtone_lvl1e3 = ga_testtone_lvl1e3.load(std::memory_order_acquire);
	const float testtone_hz = 440.0f;
	const float testtone_inc = (2.0f*M_PI*testtone_hz) / (float)g_sample_rate;
	ga_num_process_calls++;

	for (int i0 = 0; i0 < n_outputs; i0++) {
		const AudioSampleFrame* output = &outputs[i0];
		const int n_samples = output->samplesPerChannel;
		const int n_channels = output->numberOfChannels;
		//printf("nch:%d nsmp:%d\n", n_channels, n_samples);

		float* wp = output->data;
		for (int i1 = 0; i1 < n_samples; i1++) {
			float testtone_out = 0.0f;
			g_current_testtone_lvl1e3 += target_testtone_lvl1e3>g_current_testtone_lvl1e3 ? 1 : target_testtone_lvl1e3<g_current_testtone_lvl1e3 ? -1 : 0;
			if (g_current_testtone_lvl1e3 > 0) {
				const float testtone_lvl = (float)g_current_testtone_lvl1e3 * 1e-3f;
				testtone_out = sinf(g_testtone_phase) * testtone_lvl;
				g_testtone_phase += testtone_inc;
				while (g_testtone_phase > (2.0f*M_PI)) g_testtone_phase -= (2.0f*M_PI);
			}
			*(wp++) = + testtone_out;
		}
		for (int i1 = 1; i1 < n_channels; i1++) {
			memcpy(output->data + (i1 * n_samples), output->data, sizeof(output->data[0]) * n_samples);
		}
		// TODO add actual signal here
	}

	return true; // Keep the graph output going
}

bool canvas_click_handler_that_resumes_audio(int type, const EmscriptenMouseEvent* ev, void* usr)
{
	g_audio_resume_on_click_attempted = true;
	EMSCRIPTEN_WEBAUDIO_T ctx = (EMSCRIPTEN_WEBAUDIO_T)usr;
	if (emscripten_audio_context_state(ctx) != AUDIO_CONTEXT_STATE_RUNNING) {
		emscripten_resume_audio_context_sync(ctx);
	}
	return false;
}

static const char* audio_worklet_name = "eine-klejne-audio-worklet";

void audio_worklet_created(EMSCRIPTEN_WEBAUDIO_T ctx, bool success, void* usr)
{
	if (!success) return; // Check browser console in a debug build for detailed errors

	int output_channel_counts[1] = { 2 };
	EmscriptenAudioWorkletNodeCreateOptions options = {
		.numberOfInputs = 0,
		.numberOfOutputs = 1,
		.outputChannelCounts = output_channel_counts
	};

	EMSCRIPTEN_AUDIO_WORKLET_NODE_T aw = emscripten_create_wasm_audio_worklet_node(ctx, audio_worklet_name, &options, &audio_worklet_process, 0);
	emscripten_audio_node_connect(aw, ctx, 0, 0);

	// browsers prevent audio from starting ("resuming") unless initiated
	// by a user event
	emscripten_set_click_callback("canvas", (void*)ctx, 0, canvas_click_handler_that_resumes_audio);
}

void audio_worklet_init(EMSCRIPTEN_WEBAUDIO_T ctx, bool success, void* usr)
{
	if (!success) return; // Check browser console in a debug build for detailed errors
	WebAudioWorkletProcessorCreateOptions opts = {
		.name = audio_worklet_name,
	};
	emscripten_create_wasm_audio_worklet_processor_async(ctx, &opts, &audio_worklet_created, 0);
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

EM_JS(double, get_context_sample_rate, (int handle), {
	return EmAudio[handle].sampleRate;
})

void worker_worker(void)
{
	//printf("worker worker id: %u\n", emscripten_wasm_worker_self_id());
}

int main(int argc, char** argv)
{
	g_num_cores = emscripten_navigator_hardware_concurrency();

	int num_workers = g_num_cores;
	if (num_workers < 1) num_workers = 1;
	for (int i = 0; i < num_workers; i++) {
		emscripten_wasm_worker_post_function_v(
			emscripten_malloc_wasm_worker(/*stacksize=*/1<<10),
			worker_worker
		);
	}

	#if 0
	const EmscriptenWebAudioCreateAttributes attr = {
		.latencyHint = "balanced", // "balanced", "interactive" or "playback"
		.sampleRate = 48000,
	};
	EMSCRIPTEN_WEBAUDIO_T context = emscripten_create_audio_context(&attr);
	#else
	EMSCRIPTEN_WEBAUDIO_T context = emscripten_create_audio_context(nullptr);
	#endif


	//printf("main worker id: %u\n", emscripten_wasm_worker_self_id());

	g_sample_rate = (int)get_context_sample_rate(context);

	emscripten_start_wasm_audio_worklet_thread_async(context, audio_thread_stack, sizeof(audio_thread_stack), &audio_worklet_init, 0);

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
