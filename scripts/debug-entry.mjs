import { pathToFileURL } from "url";

console.log("import.meta.url:", import.meta.url);
console.log("process.argv[1]:", process.argv[1]);
console.log(
	"pathToFileURL(process.argv[1]).href:",
	pathToFileURL(process.argv[1]).href,
);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log("MATCH!");
} else {
	console.log("NO MATCH");
}
