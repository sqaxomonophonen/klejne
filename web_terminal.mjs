import { load_font } from './web_tools.mjs';
import RectPack from './rect_pack.mjs';

export class WebTerminal {
	constructor(root_element) {
		const mk_canvas = _=>document.createElement("canvas");
		this.atlas_canvas = mk_canvas();
		this.atlas_context = this.atlas_canvas.getContext("2d");
		if (this.atlas_context === null) throw new Error("failed to get 2d context");
		this.framebuffer_canvas = mk_canvas();
		this.framebuffer_context = this.framebuffer_canvas.getContext("webgl2");
		if (this.framebuffer_context === null) throw new Error("failed to get webgl2 context");
		this.root_element = root_element;
		this.root_element.appendChild(this.framebuffer_canvas);
		this.root_element.appendChild(this.atlas_canvas);
	}

	_change_font(font_face, size, codepoint_ranges, url) {
		this.font_face = font_face;
		const ctx = this.atlas_context;
		const font_desc = size + " " + font_face;
		ctx.font = font_desc;
		const m0 = ctx.measureText("W");
		{
			const m1 = ctx.measureText("I");
			if (m1.width !== m0.width) {
				console.warn(`font from url(${url}) does not appear to be monospaced; using "W" metrics for all glyphs`);
			}
		}

		const glyph_width = m0.width;
		// XXX I'm not entirely sure how to figure out height...
		const glyph_height = m0.emHeightAscent + m0.emHeightDescent;
		//const glyph_height = m0.actualBoundingBoxAscent + m0.actualBoundingBoxDescent;
		//console.log(size,m0,glyph_width, glyph_height);

		// XXX FIXME: I also need to allocate for blur/scaled ones

		let rects = [];
		for (const [cp0,cp1] of codepoint_ranges) {
			for (let cp=cp0; cp<=cp1; ++cp) {
				rects.push({w:glyph_width, h:glyph_height, cp:cp, });
			}
		}

		let atlas_width_log2 = 8;
		let atlas_height_log2 = 8;
		for (;;) {
			let w = 1 << atlas_width_log2;
			let h = 1 << atlas_height_log2;
			let rp = new RectPack(w,h,w);
			if (rp.pack(rects)) {
				break;
			} else {
				if (atlas_width_log2 > atlas_height_log2) {
					atlas_height_log2++;
				} else {
					atlas_width_log2++;
				}
			}
		}
		const width = 1 << atlas_width_log2;
		const height = 1 << atlas_height_log2;

		this.atlas_canvas.width = width;
		this.atlas_canvas.height = height;

		ctx.clearRect(0,0,width,height);
		ctx.fillStyle = '#fff';
		ctx.font = font_desc;
		for (const r of rects) {
			ctx.fillText(String.fromCodePoint(r.cp), r.x, r.y + m0.emHeightAscent);
		}

		const data = ctx.getImageData(0,0,width,height);
		console.log(data);


		//console.log(atlas_width_log2, atlas_height_log2, rects);
	}

	set_font(url, size, codepoint_ranges) {
		if (!codepoint_ranges) codepoint_ranges = [[0x20,0xff]];
		return new Promise((resolve, reject) => {
			load_font(url).then(ff => {
				this._change_font(ff, size, codepoint_ranges, url);
				resolve(true);
			}).catch(reject);
		});
	}
}
