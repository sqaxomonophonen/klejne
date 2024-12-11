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

//console.log(inst.exports);
/*
try {
	inst.exports.selftest_assertion_failure();
} catch (e) {
	if (e instanceof WebAssembly.RuntimeError) {
		//console.log(inst.exports.get_message());
		//console.log(mem.buffer);
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
