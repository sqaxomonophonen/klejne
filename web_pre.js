Module["pasted_text"] = "";
Module["locateFile"] = (path, scriptDirectory) => {
	// application files (html/js/wasm) are patched in order to move/rename
	// the paths as desired (to serve them from /_static/ and to version
	// them). however, unless "locateFile" is overridden like this, it
	// attempts to do some path manipulation that corrupts request URLs
	return path;
}
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
	}
];
