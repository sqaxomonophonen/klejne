#include "imgui.h"

#include "klejne.h"

static bool show_demo_window = false;
static bool show_audio_window = true;

void window_root(void)
{
	if (show_demo_window) ImGui::ShowDemoWindow(&show_demo_window);
	if (show_audio_window) window_audio(&show_audio_window);

	ImGui::Begin("Klejne Panel");
	ImGui::Checkbox("Show audio window", &show_audio_window);
	ImGui::Checkbox("Show ImGui demo window", &show_demo_window);
	ImGui::End();
}
