import { make_font_atlas, AtlasFont } from "./webworkerlib_graphics.mjs";
import { assert, panic } from "./util.mjs";
import { image_bitmap_to_image, u8arr_bitmap_to_image } from './web_tools.mjs';
import { GGL } from './gl.mjs';

class WebTerminal {
	constructor() {
		this.root_element = null;
		this.atlas = null;
		this.atlas_tex = null;
		this.atlas_is_new = false;
	}

	setup_gl() {
		this.ggl = new GGL(this.gl);
		const {gl,ggl} = this;
		this.atlas_tex = gl.createTexture();
		ggl.must_compile_shader(gl.VERTEX_SHADER, `#version 300 es
		void main() {
		}
		`);
	}

	mount(root_element) {
		assert(this.root_element === null, "already mounted");
		this.root_element = root_element;
		this.canvas = document.createElement("canvas");
		this.gl = this.canvas.getContext("webgl2");
		if (this.gl === null) panic("failed to get webgl2 context");
		this.setup_gl();
		this.root_element.appendChild(this.canvas);
		this.render();
	}

	unmount() {
		assert(this.root_element !== null, "not mounted");
		assert(this.canvas);
		this.root_element.removeChild(this.canvas);
		this.gl = null;
		this.canvas = null;
		this.root_element = null;
	}

	set_atlas_font(atlas_font) {
		return new Promise((resolve, reject) => {
			make_font_atlas(atlas_font).then((r) => {
				u8arr_bitmap_to_image(r.width, r.height, r.bitmap).then(b => {
					const img = image_bitmap_to_image(b);
					document.body.appendChild(img);
				});
				this.atlas = r;
				this.atlas_is_new = true;
				resolve(true);
			}).catch(reject);
		});
	}

	render() {
		const gl = this.gl;
		if (!gl) return;

		if (this.atlas_is_new) {
			gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0, // level
				gl.LUMINANCE,
				this.atlas.width, this.atlas.height,
				0, // border
				gl.LUMINANCE,
				gl.UNSIGNED_BYTE,
				this.atlas.bitmap);
			this.atlas_is_new = false;
		}

		gl.clearColor(1,0,1,1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		if (this.root_element !== null) window.requestAnimationFrame(_=>this.render());
	}
}

export const create_web_terminal = (atlas_font) => new Promise((resolve, reject) => {
	if (!atlas_font) atlas_font = new AtlasFont();
	const t = new WebTerminal();
	t.set_atlas_font(atlas_font).then(_=>{
		resolve(t);
	}).catch(reject);
});
