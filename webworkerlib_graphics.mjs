import { assert } from './util.mjs';

let _worker = null;
let _rpc = null;

function worker() {
	assert(_worker!==null, "worker not yet initialized?");
	return _worker;
}

function rpc() {
	assert(_rpc!==null, "worker/rpc not yet initialized?");
	return _rpc(...arguments);
}


export function start_graphics_webworker() {
	return new Promise((resolve,reject) => {
		_worker = new Worker("./webworkermain_graphics.js", {type:"module"}); // XXX:URLHARDCODED
		let serial_counter = 0;
		let serial_map = {};
		worker().onmessage = message => {
			const data = message.data;
			if (data.status === "READY") {
				_rpc = function(fn) {
					return new Promise((resolve,reject) => {
						const serial = ++serial_counter;
						const args = [...arguments].slice(1);
						worker().postMessage({fn,serial,args});
						serial_map[serial] = {
							resolve,
							reject,
							signature: `${fn}(${JSON.stringify(args)})#${serial}`,
						};
					});
				};
				resolve(true);
				return;
			}
			if (data.status === "ERROR") {
				reject(data.error);
				return;
			}
			if (data.serial) {
				const h = serial_map[data.serial];
				if (h) {
					delete serial_map[data.serial];
					let {resolve,reject,signature} = h;
					if (data.ok) {
						resolve(data.result);
					} else {
						reject(`${signature} => ${data.error}`);
					}
					return;
				}
			}
			console.warn("TODO unhandled message from worker: ", data);
		};
	});
}

export function XXX_ding(a,b) { // XXX just a debug/test function
	return rpc("ding",a,b);
}
// TODO export function make_font_atlas 
