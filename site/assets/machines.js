(function () {
  "use strict";

  if (document.body.getAttribute("data-page") !== "machines" || !window.ECLOGITE_CATALOG) {
    return;
  }

  var catalog = window.ECLOGITE_CATALOG;
  var machines = catalog.machines || [];
  var platforms = catalog.platforms || [];
  var machineGrid = document.getElementById("machine-profile-grid");
  var searchInput = document.getElementById("machine-search");
  var kindFilter = document.getElementById("machine-kind-filter");
  var platformFilter = document.getElementById("machine-platform-filter");
  var resultCount = document.getElementById("machine-result-count");
  var profileSelect = document.getElementById("builder-profile");
  var nameInput = document.getElementById("builder-name");
  var platformSelect = document.getElementById("builder-platform");
  var backendSelect = document.getElementById("builder-backend");
  var cpuInput = document.getElementById("builder-cpu");
  var coresInput = document.getElementById("builder-cores");
  var memoryInput = document.getElementById("builder-memory");
  var runtimeModelInput = document.getElementById("builder-runtime-model");
  var kernelSelect = document.getElementById("builder-kernel");
  var output = document.getElementById("machine-json-output");
  var builderMessage = document.getElementById("machine-builder-message");
  var platformOutput = document.getElementById("pairing-platform");
  var kernelOutput = document.getElementById("pairing-kernel");
  var profileMap = new Map(machines.map(function (machine) { return [machine.name, machine]; }));
  var systemMachines = new Set((catalog.systems || []).map(function (system) { return system.machine; }));

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cpuModel(machine) {
    if (machine.resources && typeof machine.resources.cpu === "string") {
      return machine.resources.cpu;
    }
    if (machine.resources && machine.resources.cpu && machine.resources.cpu.model) {
      return machine.resources.cpu.model;
    }
    return "backend-default";
  }

  function coreCount(machine) {
    return Number(machine.resources && (machine.resources.cores || machine.resources.vcpus)) || 1;
  }

  function platformName(machine) {
    var platform = platforms.find(function (candidate) { return candidate.name === machine.platform; });
    return platform ? platform.architecture + " · " + platform.name : machine.platform;
  }

  function profileState(machine) {
    return systemMachines.has(machine.name) ? "system-ready" : (machine.status || "profile-only");
  }

  function backendLabel(backend) {
    if (backend === "physical") { return "physical"; }
    if (backend === "utm") { return "UTM"; }
    return "QEMU";
  }

  function populateSelects() {
    platforms.forEach(function (platform) {
      var filterOption = document.createElement("option");
      filterOption.value = platform.name;
      filterOption.textContent = platform.name;
      platformFilter.appendChild(filterOption);

      var builderOption = document.createElement("option");
      builderOption.value = platform.name;
      builderOption.textContent = platform.name + " · " + platform.architecture;
      platformSelect.appendChild(builderOption);
    });

    machines.forEach(function (machine) {
      var option = document.createElement("option");
      option.value = machine.name;
      option.textContent = machine.name;
      profileSelect.appendChild(option);
    });
  }

  function renderCards() {
    machineGrid.replaceChildren();
    machines.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (machine) {
      var backend = machine.runtime.backend;
      var memory = machine.resources.memoryMiB;
      var devices = machine.devices || [];
      var card = document.createElement("article");
      card.className = "machine-profile-card";
      card.setAttribute("data-profile", machine.name);
      card.setAttribute("data-kind", backend);
      card.setAttribute("data-platform", machine.platform);
      card.innerHTML = '<div class="machine-card-top">' +
        '<span class="machine-kind ' + (backend === "physical" ? "is-physical" : "is-virtual") + '">' + escapeHtml(backendLabel(backend)) + '</span>' +
        '<span class="machine-state">' + escapeHtml(profileState(machine)) + '</span>' +
        '</div>' +
        '<h3>' + escapeHtml(machine.name) + '</h3>' +
        ((machine.aliases || []).length ? '<p class="machine-aliases">aliases: ' + machine.aliases.map(escapeHtml).join(', ') + '</p>' : '') +
        '<p>' + escapeHtml(machine.description) + '</p>' +
        '<dl class="machine-card-specs">' +
        '<div><dt>platform</dt><dd>' + escapeHtml(platformName(machine)) + '</dd></div>' +
        '<div><dt>cpu</dt><dd>' + escapeHtml(cpuModel(machine)) + ' × ' + coreCount(machine) + '</dd></div>' +
        '<div><dt>memory</dt><dd>' + escapeHtml(memory) + ' MiB</dd></div>' +
        '<div><dt>model</dt><dd>' + escapeHtml(machine.runtime.machine) + '</dd></div>' +
        '</dl>' +
        '<div class="machine-device-list">' + devices.slice(0, 5).map(function (device) {
          return '<span>' + escapeHtml(typeof device === "string" ? device : device.model) + '</span>';
        }).join("") + (devices.length > 5 ? '<span>+' + (devices.length - 5) + ' devices</span>' : "") + '</div>' +
        '<button class="text-button machine-use-profile" type="button">Use profile</button>';
      machineGrid.appendChild(card);
    });
    filterCards();
  }

  function filterCards() {
    var query = searchInput.value.trim().toLowerCase();
    var kind = kindFilter.value;
    var platform = platformFilter.value;
    var shown = 0;
    machineGrid.querySelectorAll(".machine-profile-card").forEach(function (card) {
      var matchesQuery = !query || card.textContent.toLowerCase().includes(query);
      var matchesKind = kind === "all" || card.getAttribute("data-kind") === kind;
      var matchesPlatform = platform === "all" || card.getAttribute("data-platform") === platform;
      card.hidden = !(matchesQuery && matchesKind && matchesPlatform);
      if (!card.hidden) { shown += 1; }
    });
    resultCount.textContent = shown + (shown === 1 ? " profile" : " profiles");
  }

  function deviceKind(model) {
    if (/gpio/.test(model)) { return "gpio"; }
    if (/ethernet|network|virtio-net/.test(model)) { return "network"; }
    if (/usb/.test(model)) { return "usb"; }
    if (/sd|blk/.test(model)) { return "block"; }
    if (/9p|shared/.test(model)) { return "shared-directory"; }
    if (/serial|pl011|aux/.test(model)) { return "serial"; }
    if (/camera|csi/.test(model)) { return "camera"; }
    if (/audio/.test(model)) { return "audio"; }
    if (/composite|video/.test(model)) { return "video"; }
    if (/hdmi|display|dsi|framebuffer/.test(model)) { return "display"; }
    if (/spi/.test(model)) { return "spi"; }
    if (/i2c/.test(model)) { return "i2c"; }
    return "device";
  }

  function generatedDefinition() {
    var source = profileMap.get(profileSelect.value);
    var backend = backendSelect.value;
    var runtime = { backend: backend };
    if (backend === "qemu") {
      runtime.executable = source.runtime.executable || (source.platform === "x86_64" ? "qemu-system-x86_64" : (source.platform === "arm64" ? "qemu-system-aarch64" : "qemu-system-arm"));
      runtime.machine = runtimeModelInput.value.trim();
      runtime.machine_options = [];
      runtime.acceleration = source.runtime.acceleration || "auto";
    } else if (backend === "utm") {
      runtime.application = "UTM";
      runtime.minimum_version = source.runtime.minimumVersion || "5";
      runtime.host = { os: "macos", architecture: "arm64" };
      runtime.virtualization_backend = "qemu";
      runtime.machine = runtimeModelInput.value.trim();
      runtime.machine_options = [];
      runtime.acceleration = "hvf";
      runtime.bundle_format = "utm";
      runtime.disk_import = "copy";
    } else {
      runtime.board = runtimeModelInput.value.trim();
    }

    var cpu = {
      model: cpuInput.value.trim() || "unresolved",
      cores: Number(coresInput.value) || 1
    };
    if (source.resources.soc) {
      cpu.soc = source.resources.soc;
    }

    var boot = { method: source.boot.method };
    if (source.boot.console) { boot.console = source.boot.console; }
    if (source.boot.media) { boot.boot_media = source.boot.media; }
    if (source.boot.firmwarePolicy) { boot.firmware_policy = source.boot.firmwarePolicy; }

    var definition = {
      schema: "eclogite.machine/v1",
      name: nameInput.value.trim() || "unnamed-machine",
      platform: platformSelect.value,
      resources: {
        cpu: cpu,
        memory_mib: Number(memoryInput.value) || 16
      },
      runtime: runtime,
      boot: boot,
      devices: (source.devices || []).map(function (device) {
        if (typeof device !== "string") { return device; }
        return { kind: deviceKind(device), model: device };
      })
    };
    if (source.status) { definition.status = source.status; }
    return definition;
  }

  function updateOutput() {
    output.textContent = JSON.stringify(generatedDefinition(), null, 2);
    platformOutput.textContent = platformSelect.value;
    kernelOutput.textContent = kernelSelect.value;
    builderMessage.textContent = backendSelect.value === "utm" && platformSelect.value !== "arm64"
      ? "The predefined UTM runtime supports ARM64 on Apple Silicon only."
      : "";
  }

  function loadProfile(name, shouldScroll) {
    var machine = profileMap.get(name);
    if (!machine) { return; }
    profileSelect.value = machine.name;
    nameInput.value = machine.name;
    platformSelect.value = machine.platform;
    backendSelect.value = machine.runtime.backend;
    cpuInput.value = cpuModel(machine);
    coresInput.value = String(coreCount(machine));
    memoryInput.value = String(machine.resources.memoryMiB);
    runtimeModelInput.value = machine.runtime.machine;
    updateOutput();
    if (shouldScroll) {
      document.querySelector(".machine-builder").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function setMessage(text) {
    builderMessage.textContent = text;
    window.clearTimeout(setMessage.timer);
    setMessage.timer = window.setTimeout(function () { builderMessage.textContent = ""; }, 2400);
  }

  populateSelects();
  renderCards();
  loadProfile(machines[0].name, false);

  document.getElementById("virtual-machine-count").textContent = String(machines.filter(function (machine) { return machine.runtime.backend !== "physical"; }).length);
  document.getElementById("physical-machine-count").textContent = String(machines.filter(function (machine) { return machine.runtime.backend === "physical"; }).length);

  [searchInput, kindFilter, platformFilter].forEach(function (control) {
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", filterCards);
  });
  machineGrid.addEventListener("click", function (event) {
    var button = event.target.closest(".machine-use-profile");
    if (!button) { return; }
    loadProfile(button.closest(".machine-profile-card").getAttribute("data-profile"), true);
  });
  profileSelect.addEventListener("change", function () { loadProfile(profileSelect.value, false); });
  document.getElementById("machine-builder-form").addEventListener("input", updateOutput);
  document.getElementById("machine-builder-form").addEventListener("change", updateOutput);

  document.getElementById("copy-machine-json").addEventListener("click", function () {
    navigator.clipboard.writeText(output.textContent).then(function () {
      setMessage("Copied machine JSON to the clipboard.");
    }, function () {
      setMessage("Clipboard access is unavailable; select the JSON and copy it manually.");
    });
  });

  document.getElementById("download-machine-json").addEventListener("click", function () {
    var blob = new Blob([output.textContent + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = (generatedDefinition().name || "machine") + ".json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Downloaded " + link.download + ".");
  });
}());
