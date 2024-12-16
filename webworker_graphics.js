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
postMessage("READY");
