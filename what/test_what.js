#!/usr/bin/env node
const fs = require('fs');

const wasm_src = "what.wasm";
const wasm_bytes = fs.readFileSync(wasm_src)
const mod = new WebAssembly.Module(wasm_bytes);
const mem = new WebAssembly.Memory({ initial: 1024 });
const inst = new WebAssembly.Instance(mod, {
	env: {
		//__memory_base: 0,
		//tableBase: 0,
		//table: new WebAssembly.Table({ initial: 8, element: 'anyfunc' }),
		memory: mem,
		js_grow_memory: function(delta_64k_pages) {
			const before = mem.buffer.byteLength;
			if (delta_64k_pages > 0) {
				mem.grow(delta_64k_pages);
			}
			const after = mem.buffer.byteLength;
			console.debug("js_grow_memory(" + delta_64k_pages + " × 64k) :: " + before + " => " + after);
			return after;
		},
	}
});

function get_and_clear_message() {
	const msg = new Uint8Array(mem.buffer, inst.exports.get_message()); // XXX make it safer by asking for max length (array size)?
	let len = 0;
	while (msg[len] !== 0) len++;
	const s = (new TextDecoder()).decode(msg.slice(0,len));
	inst.exports.clear_message()
	return s;
}

function with_trampoline(closure) {
	try {
		return closure();
	} catch (e) {
		if (!(e instanceof WebAssembly.RuntimeError)) throw e;
		const msg = get_and_clear_message();
		if (msg) {
			const sep = msg.indexOf("\n") > 0 ? "\n" : " ";
			throw new Error("during WASM execution in " + wasm_src + ":" + sep + msg);
		} else {
			throw e;
		}
	}
}

console.log(inst.exports);

function paint(im, stride) {
	let s="";
	for (let i = 0; i < im.length; i++) {
		let v = im[i].toFixed(0);
		while (v.length<5) v=" "+v;
		s += v;
		if ((i%stride)===(stride-1)) s+= "\n";
	}
	console.log(s);
}

with_trampoline(_=>{
	inst.exports.heap_reset();
	const R=2;
	const W=8;
	const H=8;
	const KP = inst.exports.s2c_setup(R,W,H);
	const k = new Float32Array(mem.buffer,KP,R*2+1);
	k[2]=1;
	//k[1]=k[3]=0.5;
	//k[0]=k[4]=0.25;
	console.log(k);
	const IMP = inst.exports.heap_alloc_u8(W*H);
	let im = new Uint8Array(mem.buffer, IMP, W*H);
	let i=0;
	for (let y=0; y<H; y++) {
		for (let x=0; x<W; x++) {
			im[i++] = (x===(W/2)||x===(W/2-1)) && (y===(H/2)||y===(H/2-1)) ? 255 : 0;
		}
	}
	//console.log(im);
	paint(im,W);
	inst.exports.s2c_execute(IMP,W,H,W);
	//console.log(im);
	paint(im,W);
});

const message = get_and_clear_message(); if (message) console.log("MESSAGE:\n"+message);

/*
try {
	inst.exports.selftest_assertion_failure();
} catch (e) {
	if (e instanceof WebAssembly.RuntimeError) {
		const msg = new Uint8Array(mem.buffer, inst.exports.get_message());
		let len = 0;
		while (msg[len] !== 0) len++;
		if (len > 0) {
			throw new Error("during WASM execution in " + wasm_src + ": " + (new TextDecoder()).decode(msg.slice(0,len)));
			//console.error("inside " + wasm_src + ": " + (new TextDecoder()).decode(msg.slice(0,len)));
		} else {
			throw e;
		}
	} else {
		throw e;
	}
}
*/
