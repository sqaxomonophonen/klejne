addEventListener("message", (message) => {
	//console.log("worker got mail", message.data);
	const d = message.data;
	if (d.fn) {
		postMessage({
			ok:true,
			//error: "not enough stuff",
			serial:d.serial,
			result: d.fn+":yesssss",
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
const what_wasm_promise = WebAssembly.instantiateStreaming(GET("./what.wasm"), {
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

