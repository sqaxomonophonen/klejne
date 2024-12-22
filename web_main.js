import { assert, panic, uncaught, add_panic_handler } from './util.mjs';
import { create_web_terminal } from './web_terminal.mjs';
import { start_graphics_webworker, AtlasFont } from './webworkerlib_graphics.mjs';

let ww_gfx;
let wt;
window.onload = () => {

	add_panic_handler((reason, msg, stack) => {
		document.head.innerHTML = `
		<link rel="stylesheet" type="text/css" href="style.css">
		`;

		let gs = document.getElementById("guru_meditations");
		if (!gs) document.body.innerHTML = '<div id="guru_meditations"></div>'
		gs = document.getElementById("guru_meditations");

		const g_em = document.createElement("div");
		g_em.className = "guru_meditation";
		gs.appendChild(g_em);

		const msg_em = document.createElement("div");
		msg_em.className = "guru_meditation_message";
		msg_em.innerText = reason + (msg ? (" :: " + msg) : "");
		g_em.appendChild(msg_em);

		const stack_em = document.createElement("div");
		stack_em.innerText = stack;
		stack_em.className = "guru_medititation_stack";
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

	Promise.all([
		start_graphics_webworker(),
	]).then(_=>{
		Promise.all([
			create_web_terminal()
			//create_web_terminal(new AtlasFont("url", "./Iosevka-Regular.woff2", 30))
		]).then(([terminal])=>{
			console.log("GOT TERMINAL", terminal);
			terminal.mount(document.body);
		});
	});
};
