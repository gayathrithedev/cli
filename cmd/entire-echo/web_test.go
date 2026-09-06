package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
)

func completeTestBundle() ReviewBundle {
	return ReviewBundle{
		SchemaVersion: schemaVersion,
		Target:        Target{CheckpointID: "checkpoint", SessionID: "session"},
		Context:       ContextCompleteness{Status: contextComplete},
		Overview:      Claim{Text: "Local review.", EvidenceIDs: []string{"E001"}, Confidence: "confirmed"},
		Continuation:  []Claim{{Text: "Continue locally.", EvidenceIDs: []string{"E001"}, Confidence: "confirmed"}},
		Evidence:      []Evidence{{ID: "E001", Kind: "test", Locator: "local", Confidence: "confirmed"}},
	}
}

func TestLocalWebServerUsesLoopbackAndProtectsAPI(t *testing.T) {
	t.Parallel()
	server, err := startWebServer(completeTestBundle(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if host, _, err := net.SplitHostPort(server.listener.Addr().String()); err != nil || host != "127.0.0.1" {
		t.Fatalf("listener = %q, want 127.0.0.1", server.listener.Addr())
	}
	go func() { _ = server.serve() }()
	defer func() { _ = server.shutdown(context.Background()) }()
	response, err := http.Get(server.url + "api/review")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatalf("response = %d CSP=%q", response.StatusCode, response.Header.Get("Content-Security-Policy"))
	}
	if !strings.Contains(response.Header.Get("Content-Security-Policy"), "img-src 'none'") {
		t.Fatal("CSP permits image dependencies")
	}
	request, err := http.NewRequest(http.MethodPost, server.url+"api/review", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d", response.StatusCode)
	}
}

func TestServeWebHandlesCanceledContextAndInvalidBundle(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := serveWeb(ctx, completeTestBundle(), 0, false, io.Discard); err != nil {
		t.Fatalf("canceled local server = %v", err)
	}
	if _, err := newWebHandler(ReviewBundle{}); err == nil {
		t.Fatal("invalid API bundle was accepted")
	}
}

func TestBrowserAssetsUseOnlyLocalVoicesAndDependencies(t *testing.T) {
	t.Parallel()
	js, err := os.ReadFile("internal/webui/assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(js)
	for _, required := range []string{"voice.localService === true", "utterance.voice = voice", "fetch(mode === \"fixture\" ? \"review.fixture.json\" : \"/api/review\""} {
		if !strings.Contains(source, required) {
			t.Fatalf("browser privacy control missing: %s", required)
		}
	}
	for _, forbidden := range []string{"http://", "https://", "fetch(\"/api/voice", "WebSocket"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("external or cloud dependency found: %s", forbidden)
		}
	}
}

func TestIncludedBrowserFixtureIsAValidIncompleteBundle(t *testing.T) {
	t.Parallel()
	raw, err := webAssets.ReadFile("internal/webui/assets/review.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var bundle ReviewBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		t.Fatal(err)
	}
	if bundle.Context.Status != contextPartial || len(bundle.Context.Reasons) == 0 {
		t.Fatalf("fixture context = %#v", bundle.Context)
	}
	if err := validateBundle(bundle); err != nil {
		t.Fatal(err)
	}
}
