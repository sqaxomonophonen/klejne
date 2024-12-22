// constructor returns a function that you call every frame; every 1000
// milliseconds (by default/overridable) it returns the current FPS (frames per
// second), and returns null the rest of the time.

// example usage:
/*
// setup
import make_fps from './fps.mjs';
const fps_tick = make_fps(); // or: make_fps(500) to get results more often
// every frame
const maybe_fps = fps_tick();
if (maybe_fps !== null) {
   console.log("FPS is: " + maybe_fps);
}
*/

export default (every_milliseconds) => {
	if (every_milliseconds === undefined) every_milliseconds = 1000;
	let t0 = null;
	let counter = 0;
	return () => {
		if (t0 === null) t0 = Date.now();
		counter++;
		const dt = Date.now() - t0;
		if (dt >= every_milliseconds) {
			const fps = (counter*dt*(1000/every_milliseconds)) / every_milliseconds;
			counter = 0;
			t0 = Date.now();
			return fps;
		}
		return null;
	};
}
