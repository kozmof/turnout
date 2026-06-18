package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"

	converter "github.com/kozmof/turnout/packages/go/converter"
)

// buildVersion returns the module version embedded by `go install` or `go build`,
// falling back to "dev" for local builds that have no VCS or module version info.
func buildVersion() string {
	if info, ok := debug.ReadBuildInfo(); ok {
		if v := info.Main.Version; v != "" && v != "(devel)" {
			return "turnout " + v
		}
	}
	return "turnout dev"
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "convert":
		os.Exit(safeRun(func() int { return runConvert(os.Args[2:]) }))
	case "validate":
		os.Exit(safeRun(func() int { return runValidate(os.Args[2:]) }))
	case "version", "--version", "-version":
		fmt.Println(buildVersion())
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "turnout: unknown command %q\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

// safeRun executes fn and recovers from any panic, printing a user-friendly
// "internal error" message to stderr and returning exit code 2.
// Panics in the converter internals indicate compiler bugs; this wrapper
// prevents them from crashing the process with a raw stack trace.
func safeRun(fn func() int) (exitCode int) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "turnout: internal error (please report this bug): %v\n", r)
			exitCode = 2
		}
	}()
	return fn()
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  turnout convert  <input.turn> [-o output.hcl] [-state-file path] [-format hcl|json]")
	fmt.Fprintln(os.Stderr, "  turnout validate <input.turn> [-state-file path]")
	fmt.Fprintln(os.Stderr, "  turnout version")
}

func runConvert(args []string) int {
	fs := flag.NewFlagSet("convert", flag.ContinueOnError)
	output := fs.String("o", "", "output file path (use '-' for stdout; default: input with .hcl/.json extension)")
	stateFile := fs.String("state-file", "", "override state_file base path resolution")
	format := fs.String("format", "hcl", "output format: hcl or json")

	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "turnout convert: missing input file")
		fs.Usage()
		return 1
	}

	inputPath := fs.Arg(0)
	basePath := ""
	if *stateFile != "" {
		basePath = *stateFile
	}

	// Read source from stdin when the input path is "-". This lets callers feed
	// content they have already read (e.g. via a verified file descriptor)
	// without the converter re-resolving a path that could be symlink-swapped on
	// a hostile filesystem. state_file directives still resolve relative to
	// basePath, so pass -state-file when the source references one.
	fromStdin := inputPath == "-"
	var stdinSrc []byte
	if fromStdin {
		var err error
		stdinSrc, err = io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "turnout: cannot read stdin: %v\n", err)
			return 1
		}
	}

	if *format != "hcl" && *format != "json" {
		fmt.Fprintf(os.Stderr, "turnout: unknown format %q (must be hcl or json)\n", *format)
		return 1
	}

	ext := "." + *format
	outPath := *output
	if outPath == "" {
		if fromStdin {
			outPath = "-" // stdin input has no path to derive an output file from
		} else {
			outPath = strings.TrimSuffix(inputPath, filepath.Ext(inputPath)) + ext
		}
	}

	if outPath == "-" {
		return runConvertToWriter(os.Stdout, inputPath, basePath, *format, stdinSrc, fromStdin)
	}

	// Write to a temp file in the same directory so os.Rename is atomic on
	// POSIX (same filesystem). On failure the temp file is removed, leaving
	// any pre-existing outPath untouched.
	tmp, err := os.CreateTemp(filepath.Dir(outPath), ".turnout-*.tmp")
	if err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot create %s: %v\n", outPath, err)
		return 1
	}
	tmpName := tmp.Name()
	success := false
	defer func() {
		if !success {
			os.Remove(tmpName)
		}
	}()

	code := runConvertToWriter(tmp, inputPath, basePath, *format, stdinSrc, fromStdin)
	if err := tmp.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot close temporary output for %s: %v\n", outPath, err)
		return 1
	}
	if code != 0 {
		return code
	}
	if err := os.Rename(tmpName, outPath); err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot write %s: %v\n", outPath, err)
		return 1
	}
	success = true
	return 0
}

func runConvertToWriter(w io.Writer, inputPath, basePath, format string, src []byte, fromStdin bool) int {
	var result *converter.CompileResult
	var ds converter.Diagnostics
	if fromStdin {
		result, ds = converter.CompileSource("<stdin>", string(src), basePath)
	} else {
		result, ds = converter.Compile(inputPath, basePath)
	}
	if ds.HasErrors() || result == nil {
		printDiags(ds)
		return 1
	}
	printDiags(ds) // emit any compile warnings

	var emitDs converter.Diagnostics
	if format == "json" {
		emitDs = result.WriteJSON(w)
	} else {
		emitDs = result.WriteHCL(w)
	}
	if emitDs.HasErrors() {
		printDiags(emitDs)
		return 1
	}
	printDiags(emitDs) // emit any warnings from the emitter
	return 0
}

// runValidate runs parse → state resolve → lower → validate and exits 0 on
// success, 1 on any error. All diagnostics (including warnings) go to stderr.
func runValidate(args []string) int {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)
	stateFile := fs.String("state-file", "", "override state_file base path resolution")

	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "turnout validate: missing input file")
		fs.Usage()
		return 1
	}

	inputPath := fs.Arg(0)
	basePath := ""
	if *stateFile != "" {
		basePath = *stateFile
	}

	result, ds := converter.Compile(inputPath, basePath)
	printDiags(ds)
	if ds.HasErrors() {
		return 1
	}
	if result != nil {
		printDiags(result.Warnings)
	}
	return 0
}

func printDiags(ds converter.Diagnostics) {
	for _, d := range ds {
		fmt.Fprintln(os.Stderr, d.Format())
	}
}
