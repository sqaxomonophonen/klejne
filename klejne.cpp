#include "imgui.h"

#include "klejne.h"

#include "quickjs.h"

static bool show_demo_window = false;
static bool show_audio_window = true;

void window_root(void)
{
	if (show_demo_window) ImGui::ShowDemoWindow(&show_demo_window);
	if (show_audio_window) window_audio(&show_audio_window);

	ImGui::Begin("Klejne Panel");
	ImGui::Checkbox("Show audio window", &show_audio_window);
	ImGui::Checkbox("Show ImGui demo window", &show_demo_window);

	static char src[1<<16] =
		"//hello\n"
		"(x=>x**2)(25)"
		;
	static ImGuiInputTextFlags flags = ImGuiInputTextFlags_AllowTabInput;
	ImGui::InputTextMultiline("##source", src, IM_ARRAYSIZE(src), ImVec2(-FLT_MIN, ImGui::GetTextLineHeight() * 16), flags);

	if (ImGui::Button("Exec JS")) {
		JSRuntime* rt = JS_NewRuntime();
	        JSContext* ctx = JS_NewContext(rt);
		JSValue val = JS_Eval(ctx, src, strlen(src), "<input>", 0);
		const char* cstr = JS_ToCString(ctx, JS_ToString(ctx, val));
		printf("out %s\n", cstr);
	}
	ImGui::End();

}
