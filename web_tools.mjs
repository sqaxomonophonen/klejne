let font_face_serial = 0;
let font_cache = {};
const FCST_LOADING = 1;
const FCST_READY   = 2;
const FCST_FAILED  = 3;
export const load_font = (url) => new Promise((resolve, reject) => {
	const c = font_cache[url];
	if (c) {
		if (c[0] === FCST_LOADING) {
			c[1].push([resolve,reject]);
		} else if (c[0] === FCST_READY) {
			resolve(c[2]);
		} else {
			throw new Error("bad state");
		}
		return;
	}
	const face = "FontFace" + (++font_face_serial);
	let fe = [
		FCST_LOADING ,
		[[resolve,reject]],
		face,
	];
	font_cache[url] = fe;

	const ff = new FontFace(face, 'url(' + url + ')');
	ff.load().then(font => {
		if (globalThis.document) globalThis.document.fonts.add(font);
		if (globalThis.fonts) globalThis.fonts.add(font);
		for (const [fn,_] of fe[1]) fn(face);
	}).catch(err => {
		for (const [_,fn] of fe[1]) fn(err);
	});
});

export function image_bitmap_to_image(image_bitmap) {
	let canvas = document.createElement("canvas");
	let ctx = canvas.getContext("2d");
	canvas.width = image_bitmap.width;
	canvas.height = image_bitmap.height;
	ctx.drawImage(image_bitmap, 0, 0);
	let img = new Image();
	img.src = canvas.toDataURL();
	return img;
}
