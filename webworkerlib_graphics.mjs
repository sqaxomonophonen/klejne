import { assert, panic } from './util.mjs';

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


export const start_graphics_webworker = () => new Promise((resolve,reject) => {
	_worker = new Worker("./webworkermain_graphics.js", {type:"module"}); // XXX:URLHARDCODED
	let serial_counter = 0;
	let serial_map = {};
	worker().onerror = (error) => {
		panic("error in webworkermain_graphics.js worker");
	};
	worker().onmessage = (message) => {
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

// "custom codepoints"
export const CCP_BOX = -1;
export const CCP_RANGE = [CCP_BOX,CCP_BOX];

export const CODEPOINT_RANGES_LATIN1 = [CCP_RANGE,[0x20,0x7e],[0xa0,0xff]];
export const CODEPOINT_RANGES_DEFAULT = CODEPOINT_RANGES_LATIN1;

export const HDR_CONFIG_DEFAULT = [
	null,
	{
		scale: 0.7,
		blur_radius: 2,
		multiplier: 1.2,
	},
	{
		scale: 0.5,
		blur_radius: 6,
		multiplier: 1.5,
	},
	{
		scale: 0.3,
		blur_radius: 20,
		multiplier: 2.0,
	},
];

export class AtlasFont {
	constructor(source, id, size, codepoint_ranges, hdr_config, try_stupid_hack_for_missing_glyph_detection) {
		if (!source) {
			source = "face";
			id = "monospace";
		}
		if (source !== "url" && source !== "face") panic(`unhandled source ${source}`);
		if (!codepoint_ranges) codepoint_ranges = CODEPOINT_RANGES_DEFAULT;
		// XXX convenient codepoint_ranges like [[0x20,0xff]] should
		// only be used together with
		// "try_stupid_hack_for_missing_glyph_detection", or not at
		// all. (Try searching for the string to find a
		// rant/explanation elsewhere.)
		this.source = source;
		this.id = id;
		this.size = size || 20;
		this.codepoint_ranges = codepoint_ranges;
		this.hdr_config = hdr_config || HDR_CONFIG_DEFAULT;
		this.try_stupid_hack_for_missing_glyph_detection = !!try_stupid_hack_for_missing_glyph_detection;
	}
}

export function make_font_atlas(font) {
	return rpc("make_font_atlas", font);
}
