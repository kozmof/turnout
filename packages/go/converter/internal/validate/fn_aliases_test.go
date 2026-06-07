package validate

import (
	"encoding/json"
	"os"
	"testing"
)

// fnAliasEntry mirrors one entry in spec/fn-aliases.json.
type fnAliasEntry struct {
	HCL     string `json:"hcl"`
	Runtime string `json:"runtime"`
}

// fnAliasesPath is the path from the test binary's working directory
// (the package directory) to the shared fixture file at the repo root.
const fnAliasesPath = "../../../../../spec/fn-aliases.json"

func TestFnAliasesFixtureVsBuiltinFns(t *testing.T) {
	data, err := os.ReadFile(fnAliasesPath)
	if err != nil {
		t.Fatalf("could not read %s: %v", fnAliasesPath, err)
	}
	var entries []fnAliasEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatalf("could not parse %s: %v", fnAliasesPath, err)
	}

	fixtureHCL := make(map[string]string, len(entries))
	for _, e := range entries {
		fixtureHCL[e.HCL] = e.Runtime
	}

	// Every key in builtinFns must appear in the fixture.
	for name := range builtinFns {
		if _, ok := fixtureHCL[name]; !ok {
			t.Errorf("builtinFns has %q but spec/fn-aliases.json does not", name)
		}
	}

	// Every HCL key in the fixture must appear in builtinFns.
	for hcl := range fixtureHCL {
		if _, ok := builtinFns[hcl]; !ok {
			t.Errorf("spec/fn-aliases.json has %q but builtinFns does not", hcl)
		}
	}
}
