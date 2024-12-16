
import { assert, panic, uncaught, add_panic_handler } from './util.mjs';
import { load_font } from './web_tools.mjs';
import { WebTerminal } from './web_terminal.mjs';

let ww_gfx;
let wt;
window.onload = () => {

	add_panic_handler((reason, msg, stack) => {
		document.head.innerHTML = `
		<style>
		body {
			background: black;
			font-family: monospace;
			margin: 0;
		}
		.guru_meditation {
			margin: 2em;
			padding: 1em;
			border: 0.5em solid red;
			color: red;
		}
		.msg {
			font-size: 2em;
		}
		.stack {
			margin-top: 2em;
			line-height: 2em;
		}
		</style>
		`;

		let gs = document.getElementById("guru_meditations");
		if (!gs) document.body.innerHTML = '<div id="guru_meditations"></div>'
		gs = document.getElementById("guru_meditations");

		const g_em = document.createElement("div");
		g_em.className = "guru_meditation";
		gs.appendChild(g_em);

		const msg_em = document.createElement("div");
		msg_em.className = "msg";
		msg_em.innerText = reason + (msg ? (" :: " + msg) : "");
		g_em.appendChild(msg_em);

		const stack_em = document.createElement("div");
		stack_em.innerText = stack;
		stack_em.className = "stack";
		g_em.appendChild(stack_em);
	});

	// handle errors thrown
	window.onerror = (message, source, lineno, colno, error) => {
		uncaught(error);
	};

	// handle async errors
	window.onunhandledrejection = (event) => {
		uncaught(event.reason);
	};

	const ww_gfx_promise = new Promise((resolve, reject) => {
		ww_gfx = new Worker("./webworker_graphics.js", {type:"module"});
		let serial_counter = 0;
		let serial_map = {};
		ww_gfx.onmessage = message => {
			const data = message.data;
			if (data === "READY") {
				resolve(function(fn) {
					return new Promise((resolve,reject) => {
						const serial = ++serial_counter;
						const args = [...arguments].slice(1);
						ww_gfx.postMessage({fn,serial,args});
						serial_map[serial] = {
							resolve,reject,
							signature: `${fn}(${JSON.stringify(args)})#${serial}`,
						};
					});
				});
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

	//wt = new WebTerminal(document.body);
	//wt.set_font("Iosevka-Regular.woff2", "25px");

	Promise.all([ww_gfx_promise]).then(([call_ww_gfx]) => {
		call_ww_gfx("ding",1,2,3).then(result => {
			console.log("dingresult",result);
		});
	});

};
