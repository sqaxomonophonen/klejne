import { load_font } from './web_tools.mjs';
import { Rect, RectPack} from './rect_pack.mjs';

export class WebTerminal {
	constructor(root_element) {
		const mk_canvas = _=>document.createElement("canvas");
		this.atlas_canvas = mk_canvas();
		this.atlas_context = this.atlas_canvas.getContext("2d");
		if (this.atlas_context === null) {
			throw new Error
		}
		this.framebuffer_canvas = mk_canvas();
		this.framebuffer_context = this.framebuffer_canvas.getContext("webgl2");
		if (this.framebuffer_context === null) {
		}
		this.root_element = root_element;
		this.root_element.appendChild(this.framebuffer_canvas);
	}

	_change_font(font_face, size, url) {
		this.font_face = font_face;
		const ctx = this.atlas_context;
		ctx.font = size + " " + font_face;
		const m0 = ctx.measureText("W");
		{
			const m1 = ctx.measureText("I");
			if (m1.width !== m0.width) {
				console.warn(`font from url(${url}) does not appear to be monospaced; using "W" metrics for all glyphs`);
			}
		}

		const W = 1024;
		const H = 1024;
		let rp = new RectPack(W,H,W);
		let rects = [
			Rect(100,100),
			Rect(10,10),
			Rect(10,10),
			Rect(10,10),
			Rect(10,10),
		];
		rp.pack(rects);
		console.log(rects);
	}

	set_font(url, size) {
		return new Promise((resolve, reject) => {
			load_font(url).then(ff => {
				this._change_font(ff, size, url);
				resolve(true);
			}).catch(reject);
		});
	}
}
