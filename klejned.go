// go build klejned.go
// go fmt klejned.go
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type WebAppFile struct {
	Path            string
	Type            string
	Contents        []byte
	PatchedContents []byte
	UrlPath         string
	LastModified    time.Time
}

type WebApp struct {
	Files   []WebAppFile
	Version string
}

func staticPath(s string) string {
	return "/_static/" + s
}

func (app *WebApp) Refresh() {
	numChecked := 0

	for i := range app.Files {
		file := &app.Files[i]
		info, err := os.Stat(file.Path)
		if err != nil {
			panic(err)
		}
		modTime := info.ModTime()
		if modTime.Equal(file.LastModified) {
			continue
		}
		numChecked++
		file.LastModified = modTime

		file.Contents, err = os.ReadFile(file.Path)
		if err != nil {
			panic(err)
		}
	}

	if numChecked == 0 {
		return
	}

	h := sha256.New()
	for _, file := range app.Files {
		h.Write(file.Contents)
	}
	app.Version = fmt.Sprintf("%x", h.Sum(nil))
	log.Printf("app is version %s and:", app.Version)

	for i := range app.Files {
		file := &app.Files[i]
		file.UrlPath = staticPath(fmt.Sprintf("%s?v=%s", file.Path, app.Version))
		log.Printf("  app has %s", file.UrlPath)
	}

	for i := range app.Files {
		file := &app.Files[i]
		if !(file.Type == "html0" || file.Type == "js") {
			file.PatchedContents = nil
			continue
		}
		src := string(file.Contents)
		for _, f1 := range app.Files {
			src = strings.ReplaceAll(src, f1.Path, f1.UrlPath)
		}
		file.PatchedContents = []byte(src)
	}
}

func (app *WebApp) addFile(path, typ string) {
	app.Files = append(app.Files, WebAppFile{
		Path: path,
		Type: typ,
	})
}

func (app *WebApp) ServeRoot(w http.ResponseWriter, r *http.Request, hood string) {
	for _, file := range app.Files {
		if file.Type == "html0" {
			c := string(file.PatchedContents)
			jhood, err := json.Marshal(hood)
			if err != nil {
				panic(err)
			}
			c = strings.ReplaceAll(c, "\"__HOOD_REPLACE_ME__\"", string(jhood))
			mimetype(w, "text/html; charset=utf-8")
			http.ServeContent(w, r, file.Path, file.LastModified, strings.NewReader(c))
			log.Printf("GET %s %s", file.Path, file.LastModified.String())
			//log.Printf("%s", c)
			return
		}
	}
	panic("html0 not found")
}

func respond404(w http.ResponseWriter) {
	w.WriteHeader(404)
	w.Write([]byte("404 not found"))
}

func mimetype(w http.ResponseWriter, mime string) {
	w.Header().Add("Content-Type", mime)
}

func (app *WebApp) ServeStatic(w http.ResponseWriter, r *http.Request) {
	u := r.URL.String()
	for _, file := range app.Files {
		if file.UrlPath == u {
			var c []byte
			c = file.PatchedContents
			if c == nil {
				c = file.Contents
			}
			switch file.Type {
			case "js":
				mimetype(w, "application/javascript")
			case "wasm":
				mimetype(w, "application/wasm")
			default:
				panic("unhandled type: " + file.Type)
			}
			http.ServeContent(w, r, file.Path, file.LastModified, bytes.NewReader(c))
			log.Printf("GET %s %s", file.Path, file.LastModified.String())
			return
		}
	}
	log.Printf("404 GET %s", u)
	respond404(w)
}

func NewWebApp() *WebApp {
	app := &WebApp{}
	app.addFile("klejne.html", "html0")
	app.addFile("klejne.js", "js")
	app.addFile("klejne.ww.js", "js")
	app.addFile("klejne.aw.js", "js")
	app.addFile("klejne.wasm", "wasm")
	app.Refresh()
	return app
}

func main() {
	var bind string
	flag.StringVar(&bind, "bind", ":8000", "where to bind http server")
	flag.Parse()

	app := NewWebApp()

	crossOriginIsolate := func(w http.ResponseWriter) {
		h := w.Header()
		h.Add("Cross-Origin-Opener-Policy", "same-origin")
		h.Add("Cross-Origin-Embedder-Policy", "require-corp")
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		app.Refresh()
		//panic("TODO root " + r.Method + " " + r.URL.String())
		crossOriginIsolate(w)
		w.Header().Add("Cache-Control", "no-cache, no-store, must-revalidate")
		app.ServeRoot(w, r, r.URL.Path)
	})

	http.HandleFunc(staticPath(""), func(w http.ResponseWriter, r *http.Request) {
		app.Refresh()
		crossOriginIsolate(w)
		w.Header().Add("Cache-Control", "max-age=31536000")
		app.ServeStatic(w, r)
	})

	http.HandleFunc("/_api/", func(w http.ResponseWriter, r *http.Request) {
		crossOriginIsolate(w)
		panic("TODO api")
	})

	http.HandleFunc("/_cdn/", func(w http.ResponseWriter, r *http.Request) {
		crossOriginIsolate(w)
		panic("TODO cdn")
	})

	log.Printf("HTTP on %s", bind)
	log.Fatal(http.ListenAndServe(bind, nil))
}
