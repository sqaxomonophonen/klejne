import { make_font_atlas, AtlasFont } from "./webworkerlib_graphics.mjs";
import { assert, panic } from "./util.mjs";
import { image_bitmap_to_image } from './web_tools.mjs';

class WebTerminal {
	constructor() {
		const mk_canvas = _=>document.createElement("canvas");

		this.framebuffer_canvas = mk_canvas();
		this.framebuffer_context = this.framebuffer_canvas.getContext("webgl2");
		if (this.framebuffer_context === null) throw new Error("failed to get webgl2 context");

		this.root_element = null;
	}

	mount(root_element) {
		assert(this.root_element === null);
		this.root_element = root_element;
		this.root_element.appendChild(this.framebuffer_canvas);
	}

	set_atlas_font(atlas_font) {
		return new Promise((resolve, reject) => {
			make_font_atlas(atlas_font).then((r) => {
				const img = image_bitmap_to_image(r.b);
				document.body.appendChild(img);
				console.log(["TODOrrr",img]);
				resolve(true);
			}).catch(reject);
		});
	}
}

export const create_web_terminal = (atlas_font) => new Promise((resolve, reject) => {
	if (!atlas_font) atlas_font = new AtlasFont();
	const t = new WebTerminal();
	t.set_atlas_font(atlas_font).then(_=>{
		resolve(t);
	}).catch(reject);
});
