import { assert, panic, gaussian } from './util.mjs';
import { load_font } from './web_tools.mjs';
import RectPack from "./rect_pack.mjs";
import { CCP_BOX } from './webworkerlib_graphics.mjs';
import { Memory } from './wasm.mjs';

let wa;

const API = {

make_font_atlas : (font) => new Promise((resolve,reject) => {
	const after_face = (face) => {
		// initial atlas dimensions; grows to accommodate the size requirements
		// (the ideal initial values are probably slightly lower than the
		// average? idk)
		let atlas_width_log2 = 7;
		let atlas_height_log2 = 7;

		let canvas = new OffscreenCanvas(1<<atlas_width_log2, 1<<atlas_height_log2);
		let ctx = canvas.getContext("2d");
		assert(ctx);

		const font_desc = font.size + "px " + face;
		ctx.font = font_desc;

		let rects = [];

		// XXX RE: "try_stupid_hack_for_missing_glyph_detection": Like,
		// wouldn't it be nice if in JS you had access to features already
		// present in your browser? In general? Your browser definitely knows
		// when a glyph is missing (mine shows a box with the codepoint in hex
		// inside) but despite having a Font Loading API and canvas's
		// measureText() there's no "official" (or reliable) way to detect
		// whether a codepoint glyph exists in a font. FontFace has a
		// "unicodeRange" field but it's always "U+0-10FFFF" (so utterly
		// useless). But maybe writing my own WOFF2 font parser isn't so hard?
		// Lets find out... oh it's only ~1k lines of JS and it requires a
		// Brotli decompressor; cool! My browser has one! Except... it's not
		// available in JS! SEE A PATTERN HERE? I'm already pulling in a WASM
		// image scaler! Browsers have excellent image scalers (judging by
		// zooming out) but the only one that's available to you is the canvas
		// one (drawImage()) and downscaling gives ugly results in Firefox.

		// OK, long story short: the "stupid hack for missing glyph detection"
		// is to assume that missing glyph images share the same bounding box
		// and that no other glyph has the same bounding box. It seems to work,
		// but I'm not going to leave it on by default because it'll remove
		// "random" glyphs if they happen have the same bbox.

		let m0;
		if (font.try_stupid_hack_for_missing_glyph_detection) {
			// XXX assuming that codepoint=0 has no glyph
			m0 = ctx.measureText(String.fromCodePoint(0));
		}

		const num_hdr = font.hdr_config.length;
		let hdr_rects = [];
		let hdr_nfo = [];
		let passes = [];
		for (let i=0; i<num_hdr; ++i) {
			hdr_rects.push([]);
			hdr_nfo.push({});
			const cfg = font.hdr_config[i] || {
				post_multiplier: 1,
			};
			passes.push({
				post_multiplier: cfg.post_multiplier || 1,
			});
		}

		const mW = ctx.measureText("W");

		// go through requested codepoint ranges. extract glyph info via
		// canvas.

		let cp_src_rect_map = {};
		let cp_dst_rects_map = {};
		let cps = [];
		let lookup = {};
		for (const [cp0,cp1] of font.codepoint_ranges) {
			for (let cp=cp0; cp<=cp1; ++cp) {
				const m = cp < 0 ? mW : ctx.measureText(String.fromCodePoint(cp));

				let left = m.actualBoundingBoxLeft;
				let right = m.actualBoundingBoxRight;
				let ascent = m.actualBoundingBoxAscent;
				let descent = m.actualBoundingBoxDescent;
				let w = right+left;
				let h = ascent+descent;
				if (w === 0 || h === 0) continue;

				cps.push(cp);

				if (
					font.try_stupid_hack_for_missing_glyph_detection &&
					left === m0.actualBoundingBoxLeft &&
					right === m0.actualBoundingBoxRight &&
					ascent === m0.actualBoundingBoxAscent &&
					descent === m0.actualBoundingBoxDescent
				) continue;

				for (let hdr_index=0; hdr_index<num_hdr; ++hdr_index) {
					let hdr = font.hdr_config[hdr_index];
					let render_glyph = false;
					let inner_width,inner_height;
					if (hdr === null) {
						render_glyph = true;
						hdr_nfo[hdr_index] = undefined;
						inner_width = w;
						inner_height = h;
					} else {
						const s = hdr.scale;
						const r = hdr.blur_radius;
						const blurpx = Math.ceil(r*s);
						inner_width = Math.ceil(w*s);
						inner_height = Math.ceil(h*s);
						w = inner_width + 2*blurpx;
						h = inner_height + 2*blurpx;
						let nfo = hdr_nfo[hdr_index];
						nfo.blurpx = blurpx;
						if (nfo.max_width  === undefined || w > nfo.max_width)  nfo.max_width  = w;
						if (nfo.max_height === undefined || h > nfo.max_height) nfo.max_height = h;
					}
					if (lookup[cp] === undefined) {
						let a = [];
						for (let i=0; i<num_hdr; ++i) a[i]=null;
						lookup[cp] = a;
					}
					lookup[cp][hdr_index] = {
						// XXX these are not needed, but dx/dy are? can I
						// calculate those here?
						//inner_width,
						//inner_height,
					};
					const rect = { cp, hdr_index, render_glyph, left, right, ascent, descent, w, h };
					rects.push(rect);
					hdr_rects[hdr_index].push(rect);
					if (hdr === null) {
						assert(cp_src_rect_map[cp] === undefined);
						cp_src_rect_map[cp] = rect;
					} else {
						if (cp_dst_rects_map[cp] === undefined) cp_dst_rects_map[cp] = [];
						cp_dst_rects_map[cp].push(rect);
					}
				}
			}
		}
		cps.sort();

		for (;;) {
			let w = 1 << atlas_width_log2;
			let h = 1 << atlas_height_log2;
			let rp = new RectPack(w,h,w);
			if (rp.pack(rects)) {
				break;
			} else {
				// RectPack was unable to pack all rects; double the atlas area
				// and try again; prefer width over height (better for debug
				// display I suppose because displays are wider than they're
				// tall, but I'm not sure if it's better for packing? although
				// I suspect it may be due to glyph dimensions and/or packing
				// direction?)
				if (atlas_height_log2 >= atlas_width_log2) {
					atlas_width_log2++;
				} else {
					atlas_height_log2++;
				}
			}
		}

		// XXX I'm not sure what I'm doing here is for the best:
		//  - I'm trying to determine a good height (actually line spacing) for
		//    the font
		//  - (mW.actualBoundingBoxAscent+mW.actualBoundingBoxDescent) isn't
		//    tall enough (glyphs overlap)
		//  - (mW.fontBoundingBoxAscent+mW.fontBoundingBoxDescent) seems a bit
		//    too tall (but glyphs never overlap)
		//  - so here I'm finding the extremes of
		//    actualBoundingBoxAscent/Descent for a couple of chars that goes
		//    above and below the base area... what could possibly go wrong!
		const good_ones = ["j","l","]","|"].map(x=>ctx.measureText(x));
		const common_ascent  = Math.max(...good_ones.map(x=>x.actualBoundingBoxAscent))
		const common_descent = Math.max(...good_ones.map(x=>x.actualBoundingBoxDescent))

		for (const rect of rects) {
			const lu = lookup[rect.cp][rect.hdr_index];
			lu.u = rect.x;
			lu.v = rect.y;
			lu.w = rect.w;
			lu.h = rect.h;
		}

		for (const rect of rects) {
			if (rect.hdr_index !== 0) continue;
			const lu = lookup[rect.cp][0];
			lu.dx = lu.dy = 0;
			if (rect.left)   lu.dx = -rect.left;
			if (rect.ascent) lu.dy = -rect.ascent + common_ascent;
			lu.w2=lu.w;
			lu.h2=lu.h;
		}

		for (const rect of rects) {
			if (rect.hdr_index === 0) continue;
			const lu0 = lookup[rect.cp][0];
			const lu = lookup[rect.cp][rect.hdr_index];

			const p = font.hdr_config[rect.hdr_index].blur_radius;
			//const p = hdr_nfo[rect.hdr_index].blurpx;
			const p2 = 2*p;
			lu.dx = lu0.dx-p;
			lu.dy = lu0.dy-p;
			lu.w2 = lu0.w2+p2;
			lu.h2 = lu0.h2+p2;
		}

		const width  = canvas.width  = 1<<atlas_width_log2;
		const height = canvas.height = 1<<atlas_height_log2;

		const DEBUG = false;

		ctx.clearRect(0,0,width,height);
		ctx.font = font_desc;
		if (DEBUG) {
			ctx.fillStyle = '#000';
			ctx.fillRect(0,0,width,height);
		}

		for (const r of rects) {
			if (DEBUG) {
				ctx.fillStyle = '#' + (2+Math.random()*2|0) + (2+Math.random()*2|0) + (2+Math.random()*2|0);
				ctx.fillRect(r.x, r.y, r.w, r.h);
			}
			ctx.fillStyle = '#fff';
			if (r.render_glyph) {
				if (r.cp >= 0) {
					ctx.fillText(String.fromCodePoint(r.cp), r.x+r.left, r.y+r.ascent);
				} else if (r.cp === CCP_BOX) {
					ctx.fillRect(r.x, r.y, r.w, r.h);
				} else {
					panic(`unhandled codepoint ${r.cp}`);
				}
			}
		}

		let max_num_rects = 0;
		let ser2rectpair = [];
		{
			let k2ser = {};
			let next_ser = 0;
			for (const cp of cps) {
				const src_rect = cp_src_rect_map[cp];
				assert(src_rect);
				for (const dst_rect of cp_dst_rects_map[cp]) {
					const blurpx2 = 2*hdr_nfo[dst_rect.hdr_index].blurpx;
					const dw = dst_rect.w - blurpx2;
					const dh = dst_rect.h - blurpx2;
					const k = src_rect.w+"x"+src_rect.h+">"+dw+"x"+dh+"s"+(font.hdr_config[dst_rect.hdr_index].scale.toFixed(4));
					let ser = k2ser[k];
					if (ser === undefined) {
						ser = k2ser[k] = (next_ser++);
						ser2rectpair[ser] = [];
					}
					ser2rectpair[ser].push([src_rect,dst_rect]);
					const n = ser2rectpair[ser].length;
					if (n > max_num_rects) max_num_rects = n;
				}
			}
		}

		const whusm = wa.instance.exports;
		whusm.heap_reset();
		const num_pixels = width*height;
		const stride = width;
		const bitmap_baseptr = whusm.allocate_and_set_current_monochrome_bitmap(width, height);
		const io_ptrs_baseptr = whusm.heap_alloc_ptr(2*max_num_rects);

		{ // copy canvas bitmap to wasm memory
			let bitmap = wasm_memory.unsafe_u8arr(bitmap_baseptr, num_pixels);
			const canvas_bitmap = ctx.getImageData(0,0,width,height).data;
			for (let i=0; i<num_pixels; i++) {
				bitmap[i] = canvas_bitmap[i*4+3];
			}
		}

		for (const rectpairs of ser2rectpair) {
			const [s0,d0] = rectpairs[0];
			const num = rectpairs.length;

			const P = hdr_nfo[d0.hdr_index].blurpx;
			const P2 = 2*P;

			{
				let io_ptrs = wasm_memory.unsafe_u32arr(io_ptrs_baseptr, 2*max_num_rects);
				for (let i = 0; i < num; i++) {
					const [s,d] = rectpairs[i];
					const xy2p = (x,y) => bitmap_baseptr+x+y*stride;
					io_ptrs[i*2+0] = xy2p(s.x,s.y);
					io_ptrs[i*2+1] = xy2p(d.x+P, d.y+P);
				}
			}

			whusm.resize_multiple_monochrome_subbitmaps(
				num,
				s0.w, s0.h,
				d0.w-P2, d0.h-P2,
				font.hdr_config[d0.hdr_index].scale,
				io_ptrs_baseptr,
				stride);
		}
		for (let hdr_index=0; hdr_index<num_hdr; ++hdr_index) {
			let hdr = font.hdr_config[hdr_index];
			const nfo = hdr_nfo[hdr_index]
			if (!nfo) continue;
			whusm.heap_save();
			const n0 = nfo.blurpx;
			const n1 = n0*2+1;
			const fp = whusm.s2c_setup(n0, nfo.max_width, nfo.max_height);
			{
				let kernel = wasm_memory.unsafe_f32arr(fp, n1);
				for (let i = 0; i <= n0; i++) {
					const x = ((-n0+i)/n0)*3;
					const y = gaussian(hdr.blur_variance, x) * hdr.pre_multiplier;
					// XXX should the gaussian also be "windowed"? cosine,
					// kaiser-bessel, whatever?
					kernel[i] = y;
					kernel[n1-i-1] = y;
				}
			}
			for (const r of hdr_rects[hdr_index]) {
				whusm.s2c_execute(
					bitmap_baseptr + r.x + r.y*stride,
					r.w,
					r.h,
					stride
				);
			}
			whusm.heap_restore();
		}

		resolve({
			image: {
				data: wasm_memory.unsafe_u8arr(bitmap_baseptr, num_pixels),
				width,
				height,
			},
			glyphdim: {
				width:  mW.width,
				height: Math.round(common_ascent + common_descent),
			},
			passes,
			lookup,
		});
	};

	if (font.source === "url") {
		load_font(font.id).then(face => {
			after_face(face);
		}).catch(reject);
	} else if (font.source === "face") {
		after_face(font.id);
	} else {
		panic(`unhandled source ${font.source}`);
	}
}),

};

addEventListener("message", (message) => {
	const { serial, fn, args } = message.data;
	let ff = API[fn];
	if (ff) {
		ff(...args).then((result, transfer) => {
			postMessage({
				serial,
				ok:true,
				result,
			}, transfer);
		}).catch(error => {
			console.error(error);
			postMessage({
				serial,
				error: error.message + "\n" + error.stack,
			});
		});
	} else {
		postMessage({
			serial,
			error: "no such function: " + fn,
		});
	}
});

const GET = (url) => new Promise((resolve,reject) => {
	fetch(url).then((response) => {
		if (response.status >= 400) {
			response.text().then((body) => {
				reject(`GET ${url} => ${response.status} / ${body}`);
			}).catch((error) => {
				reject(`GET ${url} => ${response.status} ?? ${error}`);
			});
			return;
		}
		resolve(response);
	}).catch((error) => {
		reject(`GET ${url} => ERR/FETCH ${error}`);
	});
});

const wasm_memory = new Memory();
const cstr = (ptr) => wasm_memory.get_cstr(ptr);
const what_wasm_promise = WebAssembly.instantiateStreaming(GET("./what.wasm"), { // XXX:URLHARDCODED
	env: {
		memory: wasm_memory.get_env_mem(),
		js_print: function(message_pointer) {
			console.info("[WASM] " + cstr(message_pointer));
		},
		js_panic: function(message_pointer) {
			const msg = cstr(message_pointer);
			console.error(msg);
			throw new Error("[WASM PANIC] " + msg);
		},
		js_grow_memory: function(num_64k_pages) {
			return wasm_memory.grow(num_64k_pages);
		}
	},
});

Promise.all([what_wasm_promise]).then(([what_wasm]) => {
	wa = what_wasm;
	console.log("what.wasm :: " + Object.keys(what_wasm.instance.exports).join(" "));
	postMessage({status:"READY"});
}).catch(error => {
	postMessage({status:"ERROR",error});
});
