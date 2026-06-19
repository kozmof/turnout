package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOpenedContainedStateFileRejectsMismatchedInode(t *testing.T) {
	base := t.TempDir()
	insidePath := filepath.Join(base, "inside.turn")
	if err := os.WriteFile(insidePath, []byte("inside"), 0o600); err != nil {
		t.Fatal(err)
	}
	outsidePath := filepath.Join(t.TempDir(), "outside.turn")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}

	outside, err := os.Open(outsidePath)
	if err != nil {
		t.Fatal(err)
	}
	defer outside.Close()

	if _, ds := readOpenedContainedStateFile(outside, insidePath, base); !ds.HasErrors() {
		t.Fatal("expected mismatched opened inode to be rejected")
	}
}

func TestReadOpenedContainedStateFileReadsPinnedDescriptor(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "state.turn")
	if err := os.WriteFile(path, []byte("safe"), 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	got, ds := readOpenedContainedStateFile(f, path, base)
	if ds.HasErrors() {
		t.Fatal(ds)
	}
	if string(got) != "safe" {
		t.Fatalf("read %q, want %q", got, "safe")
	}
}

func TestReadOpenedContainedStateFileRejectsInvalidBaseAndOutsidePath(t *testing.T) {
	outsidePath := filepath.Join(t.TempDir(), "outside.turn")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(outsidePath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	missingBase := filepath.Join(t.TempDir(), "missing")
	if _, ds := readOpenedContainedStateFile(f, outsidePath, missingBase); !ds.HasErrors() {
		t.Fatal("expected an unresolved base directory to be rejected")
	}

	base := t.TempDir()
	if _, ds := readOpenedContainedStateFile(f, outsidePath, base); !ds.HasErrors() {
		t.Fatal("expected an outside resolved path to be rejected")
	}
}

func TestReadOpenedContainedStateFileReportsDescriptorAndReadFailures(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "state.turn")
	if err := os.WriteFile(path, []byte("safe"), 0o600); err != nil {
		t.Fatal(err)
	}

	closed, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := closed.Close(); err != nil {
		t.Fatal(err)
	}
	if _, ds := readOpenedContainedStateFile(closed, path, base); !ds.HasErrors() {
		t.Fatal("expected a closed descriptor to be rejected")
	}

	dir, err := os.Open(base)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	if _, ds := readOpenedContainedStateFile(dir, base, base); !ds.HasErrors() {
		t.Fatal("expected a directory read to fail")
	}
}
