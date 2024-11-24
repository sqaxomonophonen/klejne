Module["pasted_text"] = "";
Module["preInit"] = [
	() => {
		// don't preinit in workers (right?):
		if (typeof document === "undefined") return;

		const em = document.getElementById("canvas");
		GL.makeContextCurrent(GL.createContext(em,{
			alpha: false,
			depth: false,
			stencil: false,
			antialias: false,
		}));

		document.addEventListener('paste', () => {
			event.preventDefault();
			const data = event.clipboardData.getData("text/plain");
			Module["pasted_text"] = data;
		});

		const cc = (ev) => {
			ev.preventDefault();
			//setTimeout(() => {
				ev.clipboardData.setData("text/plain", Module["pasted_text"]);
			//}, 0);
		};

		document.addEventListener('copy', () => { cc(event); });
		document.addEventListener('cut', () => { cc(event); });
	}
];
