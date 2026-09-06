package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// webAssets is deliberately limited to the reviewed static interface. The
// handler below uses an allowlist, so it cannot serve repository files.
//
//go:embed internal/webui/assets/*
var webAssets embed.FS

type localWebServer struct {
	listener net.Listener
	server   *http.Server
	url      string
}

func newWebHandler(bundle ReviewBundle) (http.Handler, error) {
	if err := validateBundle(bundle); err != nil {
		return nil, fmt.Errorf("invalid review bundle: %w", err)
	}
	reviewJSON, err := json.Marshal(bundle)
	if err != nil {
		return nil, fmt.Errorf("encode review bundle: %w", err)
	}

	assets := map[string]struct {
		file        string
		contentType string
	}{
		"/":                    {file: "index.html", contentType: "text/html; charset=utf-8"},
		"/app.js":              {file: "app.js", contentType: "text/javascript; charset=utf-8"},
		"/styles.css":          {file: "styles.css", contentType: "text/css; charset=utf-8"},
		"/review.fixture.json": {file: "review.fixture.json", contentType: "application/json; charset=utf-8"},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setBrowserHeaders(w)
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/api/review" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write(reviewJSON)
			return
		}
		asset, ok := assets[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		contents, err := webAssets.ReadFile("internal/webui/assets/" + asset.file)
		if err != nil {
			http.Error(w, "embedded interface unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", asset.contentType)
		_, _ = w.Write(contents)
	}), nil
}

func setBrowserHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
}

func startWebServer(bundle ReviewBundle, port int) (*localWebServer, error) {
	handler, err := newWebHandler(bundle)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)))
	if err != nil {
		return nil, fmt.Errorf("listen on loopback: %w", err)
	}
	return &localWebServer{
		listener: listener,
		server:   &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second},
		url:      "http://" + listener.Addr().String() + "/",
	}, nil
}

func (s *localWebServer) serve() error { return s.server.Serve(s.listener) }

func (s *localWebServer) shutdown(ctx context.Context) error { return s.server.Shutdown(ctx) }

func serveWeb(ctx context.Context, bundle ReviewBundle, port int, open bool, out io.Writer) error {
	server, err := startWebServer(bundle, port)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Entire Echo web review: %s\n", server.url)
	if open {
		name, args, supported := browserCommand(server.url)
		if supported {
			if _, _, err := (execRunner{}).Run(ctx, name, args, ""); err != nil {
				fmt.Fprintln(out, "Could not open a browser automatically; use the URL above.")
			}
		}
	}

	serveResult := make(chan error, 1)
	go func() { serveResult <- server.serve() }()
	select {
	case err := <-serveResult:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		err := <-serveResult
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
