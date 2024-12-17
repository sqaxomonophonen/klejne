import { assert } from './util.mjs';
import { load_font } from './web_tools.mjs';
import RectPack from "./rect_pack.mjs";

const api = {

make_font_atlas : (font) => new Promise((resolve,reject) => {

	const after_face = (face) => {
		let atlas_width_log2 = 7;
		let atlas_height_log2 = 7;

		let canvas = new OffscreenCanvas(1<<atlas_width_log2, 1<<atlas_height_log2);
		let ctx = canvas.getContext("2d");
		assert(ctx);

		const font_desc = font.size + "px " + face;
		ctx.font = font_desc;

		let rects = [];
		for (const [cp0,cp1] of font.codepoint_ranges) {
			for (let cp=cp0; cp<=cp1; ++cp) {
				const m = ctx.measureText(String.fromCodePoint(cp));
				let o = {
				w : (m.actualBoundingBoxRight + m.actualBoundingBoxLeft),
				h : (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
				left : m.actualBoundingBoxLeft,
				right : m.actualBoundingBoxRight,
				top : m.actualBoundingBoxAscent,
				bottom : m.actualBoundingBoxDescent,
				baseline : m.alphabeticBaseline,
				};
				//console.log(o);
				rects.push({...o,cp,m});
			}
		}

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

		canvas.width  =  1<<atlas_width_log2;
		canvas.height =  1<<atlas_height_log2;

		ctx.clearRect(0,0,canvas.width,canvas.height);
		ctx.fillStyle = '#fff';
		ctx.font = font_desc;
		for (const r of rects) {
			ctx.fillText(String.fromCodePoint(r.cp), r.x+r.m.actualBoundingBoxLeft, r.y+r.m.actualBoundingBoxAscent+r.m.alphabeticBaseline);
		}

		// XXX TODO

		const b = canvas.transferToImageBitmap();
		resolve({b},[b]);
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
	//console.log("worker got mail", message.data);
	const { serial, fn, args } = message.data;
	let ff = api[fn];
	if (ff) {
		ff(...args).then((result, transfer) => {
			postMessage({
				serial,
				ok:true,
				result,
			}, transfer);
		}).catch(error => {
			postMessage({
				serial,
				error,
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

const wasm_memory = new WebAssembly.Memory({ initial: 16 });
const what_wasm_promise = WebAssembly.instantiateStreaming(GET("./what.wasm"), { // XXX:URLHARDCODED
	env: {
		memory: wasm_memory,
		js_grow_memory: function(delta_64k_pages) {
			const before = wasm_memory.buffer.byteLength;
			if (delta_64k_pages > 0) {
				wasm_memory.grow(delta_64k_pages);
			}
			const after = wasm_memory.buffer.byteLength;
			console.debug("js_grow_memory(" + delta_64k_pages + " × 64k) :: " + before + " => " + after);
			return after;
		},
	},
});

Promise.all([what_wasm_promise]).then(([what_wasm]) => {
	console.log("what.wasm :: " + Object.keys(what_wasm.instance.exports).join(" "));
	postMessage({status:"READY"});
}).catch(error => {
	postMessage({status:"ERROR",error});
});
