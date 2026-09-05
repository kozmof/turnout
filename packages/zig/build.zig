const std = @import("std");

/// The three modules that make up the package: two feature layers plus the
/// WASM ABI that composes them. Every build target needs its own instance,
/// so the graph is built once per target.
const Layers = struct {
    runtime: *std.Build.Module,
    scene_runner: *std.Build.Module,
    wasm_abi: *std.Build.Module,
};

/// A test binary per module. Zig discovers tests only within the module under
/// test, so each layer is compiled and run on its own.
const TestBinary = struct {
    name: []const u8,
    module: *std.Build.Module,
};

/// One distributed WASM artifact.
///
/// The same source is built twice, because the two deployments want opposite
/// things. A server or CLI host has the module on local disk and cares only
/// about how fast it runs. A browser downloads it before anything can run, so
/// its size is part of the startup cost. `ReleaseSmall` is about a seventh of
/// the size for about 14% less throughput, which is the right trade in one case
/// and the wrong one in the other.
///
/// Both are built without safety checks. `ReleaseSafe` costs about 6% against
/// `ReleaseFast` and keeps bounds and overflow checks; switching either entry
/// below is the whole change if that trade is preferred.
const DistArtifact = struct {
    name: []const u8,
    optimize: std.builtin.OptimizeMode,
};

const dist_artifacts = [_]DistArtifact{
    .{ .name = "turnout-runtime", .optimize = .ReleaseFast },
    .{ .name = "turnout-runtime.compact", .optimize = .ReleaseSmall },
};

/// Wires the layer graph for one target. `public` exposes the layers under
/// their module names for dependents; only the host graph needs that.
fn addLayers(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    public: bool,
) Layers {
    const runtime_options: std.Build.Module.CreateOptions = .{
        .root_source_file = b.path("runtime/src/root.zig"),
        .target = target,
        .optimize = optimize,
    };
    const scene_runner_options: std.Build.Module.CreateOptions = .{
        .root_source_file = b.path("scene-runner/src/root.zig"),
        .target = target,
        .optimize = optimize,
    };
    const wasm_abi_options: std.Build.Module.CreateOptions = .{
        .root_source_file = b.path("wasm/src/abi.zig"),
        .target = target,
        .optimize = optimize,
    };

    const runtime = if (public)
        b.addModule("turnout_runtime", runtime_options)
    else
        b.createModule(runtime_options);
    const scene_runner = if (public)
        b.addModule("turnout_scene_runner", scene_runner_options)
    else
        b.createModule(scene_runner_options);
    const wasm_abi = if (public)
        b.addModule("turnout_wasm_abi", wasm_abi_options)
    else
        b.createModule(wasm_abi_options);

    scene_runner.addImport("turnout_runtime", runtime);
    wasm_abi.addImport("turnout_runtime", runtime);
    wasm_abi.addImport("turnout_scene_runner", scene_runner);

    return .{ .runtime = runtime, .scene_runner = scene_runner, .wasm_abi = wasm_abi };
}

fn testBinaries(layers: Layers) [3]TestBinary {
    return .{
        .{ .name = "turnout-runtime-tests", .module = layers.runtime },
        .{ .name = "turnout-scene-runner-tests", .module = layers.scene_runner },
        .{ .name = "turnout-wasm-abi-tests", .module = layers.wasm_abi },
    };
}

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const layers = addLayers(b, target, optimize, true);
    const test_step = b.step("test", "Run Turnout Zig runtime tests");
    for (testBinaries(layers)) |binary| {
        const tests = b.addTest(.{ .name = binary.name, .root_module = binary.module });
        test_step.dependOn(&b.addRunArtifact(tests).step);
    }

    const wasi_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .wasi,
    });
    const wasi_layers = addLayers(b, wasi_target, optimize, false);
    const wasi_test_step = b.step("wasm-test-artifact", "Build the WASI core test artifacts");
    for (testBinaries(wasi_layers)) |binary| {
        const wasi_tests = b.addTest(.{ .name = binary.name, .root_module = binary.module });
        wasi_test_step.dependOn(&b.addInstallArtifact(wasi_tests, .{}).step);
    }

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    // The development artifact. Debug unless asked otherwise, because this is
    // what the test suites load and they want fast rebuilds and safety checks.
    const wasm_step = b.step("wasm", "Build the Turnout WASM runtime for development");
    wasm_step.dependOn(&b.addInstallArtifact(
        wasmModule(b, wasm_target, optimize, "turnout-runtime"),
        .{},
    ).step);

    // The distributed artifacts, installed to zig-out/dist so a development
    // build can never be mistaken for one of them at packaging time.
    const dist_step = b.step("wasm-dist", "Build the distributed Turnout WASM artifacts");
    for (dist_artifacts) |artifact| {
        dist_step.dependOn(&b.addInstallArtifact(
            wasmModule(b, wasm_target, artifact.optimize, artifact.name),
            .{ .dest_dir = .{ .override = .{ .custom = "dist" } } },
        ).step);
    }
}

fn wasmModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    name: []const u8,
) *std.Build.Step.Compile {
    const layers = addLayers(b, target, optimize, false);
    const wasm = b.addExecutable(.{ .name = name, .root_module = layers.wasm_abi });
    wasm.entry = .disabled;
    wasm.export_memory = true;
    wasm.rdynamic = true;
    return wasm;
}
