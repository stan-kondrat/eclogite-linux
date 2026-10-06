(function () {
  "use strict";

  if (document.body.getAttribute("data-page") !== "packages" || !window.ECLOGITE_CATALOG) {
    return;
  }

  var catalog = window.ECLOGITE_CATALOG;
  var svg = document.getElementById("dependency-graph");
  var viewport = document.getElementById("graph-viewport");
  var edgesGroup = document.getElementById("graph-edges");
  var nodesGroup = document.getElementById("graph-nodes");
  var inspector = document.getElementById("node-inspector");
  var systemFilter = document.getElementById("system-filter");
  var viewFilter = document.getElementById("view-filter");
  var searchInput = document.getElementById("graph-search");
  var packageGrid = document.getElementById("package-grid");
  var packageResultCount = document.getElementById("package-result-count");
  var visibleCount = document.getElementById("visible-count");
  var zoomLabel = document.getElementById("zoom-label");
  var emptyState = document.getElementById("graph-empty");
  var namespace = "http://www.w3.org/2000/svg";

  var packageMap = indexByName(catalog.packages);
  var metaMap = indexByName(catalog.metapackages);
  var platformMap = indexByName(catalog.platforms);
  var machineMap = indexByName(catalog.machines || []);
  var softwareMap = indexByName(catalog.software || []);
  var toolchainMap = indexByName(catalog.toolchains);
  var stageMap = indexByName(catalog.stages);
  var systemMap = indexByName(catalog.systems);

  var state = {
    system: catalog.systems[0] ? catalog.systems[0].name : "all",
    view: "full",
    kinds: new Set(["system", "machine", "software", "platform", "stage", "metapackage", "package", "toolchain"]),
    nodes: [],
    edges: [],
    positions: new Map(),
    selected: null,
    trace: "both",
    query: "",
    scale: 1,
    translateX: 0,
    translateY: 0,
    interaction: null
  };

  function indexByName(items) {
    var map = new Map();
    items.forEach(function (item) { map.set(item.name, item); });
    return map;
  }

  function nodeId(kind, name) {
    return kind + ":" + name;
  }

  function titleForKind(kind) {
    return {
      system: "System",
      machine: "Machine",
      software: "Software",
      platform: "Platform",
      stage: "Stage",
      metapackage: "Meta-package",
      package: "Package",
      toolchain: "Toolchain"
    }[kind] || kind;
  }

  function addNode(collection, kind, item) {
    if (!item) {
      return null;
    }
    var id = nodeId(kind, item.name);
    if (!collection.has(id)) {
      collection.set(id, {
        id: id,
        kind: kind,
        name: item.name,
        data: item
      });
    }
    return id;
  }

  function addEdge(collection, from, to, relation, label) {
    if (!from || !to || from === to) {
      return;
    }
    var key = from + "|" + to + "|" + relation;
    if (!collection.has(key)) {
      collection.set(key, { id: key, from: from, to: to, relation: relation, label: label || relation });
    }
  }

  function addPackageClosure(name, nodes, edges) {
    var item = packageMap.get(name);
    var id = addNode(nodes, "package", item);
    if (!item || !id) {
      return id;
    }

    ["build", "link", "runtime"].forEach(function (relation) {
      (item.dependencies[relation] || []).forEach(function (dependency) {
        var dependencyId = addPackageClosure(dependency, nodes, edges);
        addEdge(edges, id, dependencyId, relation, relation);
      });
    });
    return id;
  }

  function addMetaClosure(name, nodes, edges) {
    var item = metaMap.get(name);
    var id = addNode(nodes, "metapackage", item);
    if (!item || !id) {
      return id;
    }

    item.members.forEach(function (member) {
      var childId;
      if (member.charAt(0) === "@") {
        childId = addMetaClosure(member.slice(1), nodes, edges);
      } else {
        childId = addPackageClosure(member, nodes, edges);
      }
      addEdge(edges, id, childId, "selection", "includes");
    });
    return id;
  }

  function addSelection(selection, nodes, edges) {
    return selection.charAt(0) === "@"
      ? addMetaClosure(selection.slice(1), nodes, edges)
      : addPackageClosure(selection, nodes, edges);
  }

  function buildGraph() {
    var nodes = new Map();
    var edges = new Map();
    var selectedSystems = state.system === "all"
      ? catalog.systems
      : [systemMap.get(state.system)].filter(Boolean);
    var includeStructure = state.view !== "packages";
    var includePackages = state.view !== "stages";

    selectedSystems.forEach(function (system) {
      var systemNode = includeStructure ? addNode(nodes, "system", system) : null;
      var machine = machineMap.get(system.machine);
      var software = softwareMap.get(system.software);
      var softwareNode = null;

      if (includeStructure) {
        var machineNode = addNode(nodes, "machine", machine);
        softwareNode = addNode(nodes, "software", software);
        addEdge(edges, systemNode, machineNode, "selection", "machine");
        addEdge(edges, systemNode, softwareNode, "selection", "software");

        var machinePlatform = addNode(nodes, "platform", platformMap.get(machine && machine.platform));
        var softwarePlatform = addNode(nodes, "platform", platformMap.get(software && software.platform));
        addEdge(edges, machineNode, machinePlatform, "platform", "supports");
        addEdge(edges, softwareNode, softwarePlatform, "platform", "targets");
      }

      (software ? software.stages : []).forEach(function (stageName) {
        var stage = stageMap.get(stageName);
        if (!stage) {
          return;
        }

        var stageNode = includeStructure ? addNode(nodes, "stage", stage) : null;
        if (includeStructure) {
          addEdge(edges, softwareNode, stageNode, "selection", "contains");
          var toolchainNode = addNode(nodes, "toolchain", toolchainMap.get(stage.toolchain));
          addEdge(edges, stageNode, toolchainNode, "toolchain", "uses");
        }

        stage.after.forEach(function (dependencyStage) {
          if (includeStructure) {
            var dependencyNode = addNode(nodes, "stage", stageMap.get(dependencyStage));
            addEdge(edges, stageNode, dependencyNode, "order", "after");
          }
        });

        if (includePackages) {
          stage.selections.forEach(function (selection) {
            var selectionNode = addSelection(selection, nodes, edges);
            if (includeStructure) {
              addEdge(edges, stageNode, selectionNode, "selection", "selects");
            }
          });
        }
      });

      if (includePackages && software && software.kernel) {
        var kernelNode = addPackageClosure(software.kernel, nodes, edges);
        if (includeStructure) {
          var kernelStage = addNode(nodes, "stage", stageMap.get("target-kernel"));
          addEdge(edges, kernelStage, kernelNode, "selection", "kernel");
        }
      }
    });

    var filteredNodes = Array.from(nodes.values()).filter(function (node) {
      return state.kinds.has(node.kind);
    });
    var allowed = new Set(filteredNodes.map(function (node) { return node.id; }));
    var filteredEdges = Array.from(edges.values()).filter(function (edge) {
      return allowed.has(edge.from) && allowed.has(edge.to);
    });

    filteredNodes.sort(function (a, b) {
      var kindOrder = ["system", "machine", "software", "platform", "stage", "toolchain", "metapackage", "package"];
      var delta = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
      return delta || a.name.localeCompare(b.name);
    });

    state.nodes = filteredNodes;
    state.edges = filteredEdges;
    if (state.selected && !allowed.has(state.selected)) {
      state.selected = null;
    }
  }

  function layerForNode(node) {
    if (state.view === "packages") {
      if (node.kind === "metapackage") {
        return node.name === "reference-system" ? 0 : 1;
      }
      return 2;
    }

    var layer = {
      system: 0,
      machine: 1,
      software: 1,
      platform: 2,
      stage: 2,
      toolchain: 3,
      metapackage: 3,
      package: 4
    }[node.kind];
    return layer == null ? 4 : layer;
  }

  function layoutGraph() {
    var layers = new Map();
    state.nodes.forEach(function (node) {
      var layer = layerForNode(node);
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer).push(node);
    });

    var largest = 1;
    layers.forEach(function (items) { largest = Math.max(largest, items.length); });
    var worldHeight = Math.max(620, largest * 74 + 80);
    var maxLayer = Math.max.apply(null, Array.from(layers.keys()).concat([0]));
    var worldWidth = Math.max(680, maxLayer * 290 + 260);

    state.positions.clear();
    layers.forEach(function (items, layer) {
      items.sort(function (a, b) {
        if (a.kind === "metapackage" && b.kind === "metapackage") {
          if (a.name === "reference-system") { return -1; }
          if (b.name === "reference-system") { return 1; }
        }
        return a.name.localeCompare(b.name);
      });
      items.forEach(function (node, index) {
        state.positions.set(node.id, {
          x: 130 + layer * 290,
          y: (index + 1) * worldHeight / (items.length + 1)
        });
      });
    });

    return { width: worldWidth, height: worldHeight };
  }

  function createSvgElement(name, attributes) {
    var element = document.createElementNS(namespace, name);
    Object.keys(attributes || {}).forEach(function (key) {
      element.setAttribute(key, String(attributes[key]));
    });
    return element;
  }

  function edgePath(edge) {
    var from = state.positions.get(edge.from);
    var to = state.positions.get(edge.to);
    if (!from || !to) {
      return "";
    }

    var nodeHalfWidth = 82;
    var direction = to.x >= from.x ? 1 : -1;
    var startX = from.x + nodeHalfWidth * direction;
    var endX = to.x - nodeHalfWidth * direction;
    var span = Math.max(55, Math.abs(endX - startX) * 0.48);

    if (Math.abs(to.x - from.x) < 20) {
      var bend = 115 + Math.abs(to.y - from.y) * 0.15;
      return "M" + from.x + "," + (from.y + 23) +
        " C" + (from.x + bend) + "," + (from.y + 48) +
        " " + (to.x + bend) + "," + (to.y - 48) +
        " " + to.x + "," + (to.y - 23);
    }

    return "M" + startX + "," + from.y +
      " C" + (startX + span * direction) + "," + from.y +
      " " + (endX - span * direction) + "," + to.y +
      " " + endX + "," + to.y;
  }

  function renderGraph() {
    edgesGroup.replaceChildren();
    nodesGroup.replaceChildren();

    state.edges.forEach(function (edge) {
      var path = createSvgElement("path", {
        d: edgePath(edge),
        class: "graph-edge",
        "data-edge-id": edge.id,
        "data-source": edge.from,
        "data-target": edge.to,
        "data-relation": edge.relation
      });
      var title = createSvgElement("title");
      title.textContent = edge.from.split(":").slice(1).join(":") + " " + edge.label + " " + edge.to.split(":").slice(1).join(":");
      path.appendChild(title);
      edgesGroup.appendChild(path);
    });

    state.nodes.forEach(function (node) {
      var position = state.positions.get(node.id);
      var group = createSvgElement("g", {
        class: "graph-node",
        transform: "translate(" + position.x + " " + position.y + ")",
        tabindex: "0",
        role: "button",
        "aria-label": titleForKind(node.kind) + " " + node.name,
        "data-node-id": node.id,
        "data-kind": node.kind
      });
      var rect = createSvgElement("rect", { class: "node-shape", x: -82, y: -24, width: 164, height: 48, rx: 8 });
      var name = createSvgElement("text", { class: "node-name", x: 0, y: -2 });
      name.textContent = node.name;
      var kind = createSvgElement("text", { class: "node-kind", x: 0, y: 13 });
      kind.textContent = titleForKind(node.kind);
      group.append(rect, name, kind);
      group.addEventListener("pointerdown", beginNodeDrag);
      group.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node.id);
        }
      });
      nodesGroup.appendChild(group);
    });

    visibleCount.textContent = state.nodes.length + (state.nodes.length === 1 ? " node" : " nodes");
    emptyState.hidden = state.nodes.length !== 0;
    updateKindCounts();
    updateHighlight();
  }

  function updateEdgeGeometry() {
    edgesGroup.querySelectorAll(".graph-edge").forEach(function (path) {
      var edge = state.edges.find(function (candidate) {
        return candidate.id === path.getAttribute("data-edge-id");
      });
      if (edge) {
        path.setAttribute("d", edgePath(edge));
      }
    });
  }

  function graphNodeById(id) {
    return state.nodes.find(function (node) { return node.id === id; });
  }

  function adjacency(direction) {
    var map = new Map();
    state.nodes.forEach(function (node) { map.set(node.id, []); });
    state.edges.forEach(function (edge) {
      var from = direction === "dependencies" ? edge.from : edge.to;
      var to = direction === "dependencies" ? edge.to : edge.from;
      if (map.has(from)) {
        map.get(from).push(to);
      }
    });
    return map;
  }

  function traverse(start, direction) {
    var map = adjacency(direction);
    var visited = new Set([start]);
    var queue = [start];
    while (queue.length) {
      var current = queue.shift();
      (map.get(current) || []).forEach(function (next) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    return visited;
  }

  function activeNodes() {
    if (state.selected) {
      var active = new Set([state.selected]);
      if (state.trace === "dependencies" || state.trace === "both") {
        traverse(state.selected, "dependencies").forEach(function (id) { active.add(id); });
      }
      if (state.trace === "dependents" || state.trace === "both") {
        traverse(state.selected, "dependents").forEach(function (id) { active.add(id); });
      }
      return active;
    }

    if (state.query) {
      var query = state.query.toLowerCase();
      return new Set(state.nodes.filter(function (node) {
        return node.name.toLowerCase().includes(query) ||
          titleForKind(node.kind).toLowerCase().includes(query) ||
          (node.data.description || "").toLowerCase().includes(query);
      }).map(function (node) { return node.id; }));
    }

    return null;
  }

  function updateHighlight() {
    var active = activeNodes();
    nodesGroup.querySelectorAll(".graph-node").forEach(function (element) {
      var id = element.getAttribute("data-node-id");
      element.classList.toggle("is-selected", id === state.selected);
      element.classList.toggle("is-active", Boolean(active && active.has(id)));
      element.classList.toggle("is-muted", Boolean(active && !active.has(id)));
    });

    edgesGroup.querySelectorAll(".graph-edge").forEach(function (element) {
      var from = element.getAttribute("data-source");
      var to = element.getAttribute("data-target");
      var edgeActive = active && active.has(from) && active.has(to);
      element.classList.toggle("is-active", Boolean(edgeActive));
      element.classList.toggle("is-muted", Boolean(active && !edgeActive));
    });
  }

  function directRelations(id, direction) {
    var relations = [];
    state.edges.forEach(function (edge) {
      if (direction === "dependencies" && edge.from === id) {
        relations.push({ id: edge.to, relation: edge.relation });
      }
      if (direction === "dependents" && edge.to === id) {
        relations.push({ id: edge.from, relation: edge.relation });
      }
    });
    return relations;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function relationMarkup(title, relations) {
    if (!relations.length) {
      return "";
    }
    return '<div class="relation-group"><h4>' + escapeHtml(title) + '</h4><div class="relation-pills">' +
      relations.map(function (relation) {
        var name = relation.id.split(":").slice(1).join(":");
        return '<button class="relation-pill" type="button" data-select-node="' + escapeHtml(relation.id) + '" title="' + escapeHtml(relation.relation) + '">' + escapeHtml(name) + '</button>';
      }).join("") + "</div></div>";
  }

  function renderInspector(node) {
    if (!node) {
      inspector.classList.remove("has-selection");
      inspector.innerHTML = '<div class="inspector-empty"><span class="inspector-gem" aria-hidden="true"></span><h3>Select a node</h3><p>Inspect source identity, builder, direct requirements, and every node that selects it.</p></div>';
      return;
    }

    var data = node.data;
    var details = [];
    if (data.builder) { details.push(["Builder", data.builder]); }
    if (data.context) { details.push(["Context", data.context]); }
    if (data.architecture) { details.push(["Architecture", data.architecture]); }
    if (data.platform) { details.push(["Platform", data.platform]); }
    if (data.toolchain) { details.push(["Toolchain", data.toolchain]); }
    if (data.machine) { details.push(["Machine", data.machine]); }
    if (data.software) { details.push(["Software", data.software]); }
    if (data.resources) { details.push(["Resources", data.resources.vcpus + " vCPU / " + data.resources.memoryMiB + " MiB"]); }
    if (data.source) { details.push(["Source", data.source]); }
    if (data.revision) { details.push(["Revision", data.revision.slice(0, 12)]); }
    if (data.runtime) { details.push(["Runtime", data.runtime.backend + " / " + data.runtime.machine]); }

    var requirements = directRelations(node.id, "dependencies");
    var consumers = directRelations(node.id, "dependents");
    inspector.innerHTML = '<div class="inspector-content">' +
      '<button class="inspector-close" type="button" aria-label="Close inspector">×</button>' +
      '<span class="inspector-type">' + escapeHtml(titleForKind(node.kind)) + '</span>' +
      '<h3>' + escapeHtml(node.name) + '</h3>' +
      (data.version ? '<div class="inspector-version">v' + escapeHtml(data.version) + '</div>' : "") +
      '<p class="inspector-description">' + escapeHtml(data.description || "Resolved catalog node.") + '</p>' +
      (details.length ? '<dl class="inspector-table">' + details.map(function (row) {
        var value = row[1];
        if (row[0] === "Source" && /^https?:/.test(value)) {
          value = '<a href="' + escapeHtml(value) + '" target="_blank" rel="noreferrer">' + escapeHtml(value) + '</a>';
        } else {
          value = escapeHtml(value);
        }
        return '<div class="inspector-row"><dt>' + escapeHtml(row[0]) + '</dt><dd>' + value + '</dd></div>';
      }).join("") + '</dl>' : "") +
      relationMarkup("Direct requirements", requirements) +
      relationMarkup("Selected by", consumers) +
      '</div>';
    inspector.classList.add("has-selection");

    inspector.querySelector(".inspector-close").addEventListener("click", function () {
      selectNode(null);
    });
    inspector.querySelectorAll("[data-select-node]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectNode(button.getAttribute("data-select-node"));
      });
    });
  }

  function selectNode(id) {
    state.selected = id;
    updateHighlight();
    renderInspector(id ? graphNodeById(id) : null);
  }

  function updateTransform() {
    viewport.setAttribute("transform", "translate(" + state.translateX + " " + state.translateY + ") scale(" + state.scale + ")");
    zoomLabel.textContent = Math.round(state.scale * 100) + "%";
  }

  function fitGraph() {
    if (!state.nodes.length) {
      return;
    }
    var positions = Array.from(state.positions.values());
    var minX = Math.min.apply(null, positions.map(function (position) { return position.x; })) - 105;
    var maxX = Math.max.apply(null, positions.map(function (position) { return position.x; })) + 105;
    var minY = Math.min.apply(null, positions.map(function (position) { return position.y; })) - 55;
    var maxY = Math.max.apply(null, positions.map(function (position) { return position.y; })) + 55;
    var width = svg.clientWidth || 800;
    var height = svg.clientHeight || 680;
    var contentWidth = Math.max(1, maxX - minX);
    var contentHeight = Math.max(1, maxY - minY);
    state.scale = Math.min(1.15, (width - 60) / contentWidth, (height - 60) / contentHeight);
    state.scale = Math.max(0.22, state.scale);
    state.translateX = (width - contentWidth * state.scale) / 2 - minX * state.scale;
    state.translateY = (height - contentHeight * state.scale) / 2 - minY * state.scale;
    updateTransform();
  }

  function zoomAt(factor, clientX, clientY) {
    var rect = svg.getBoundingClientRect();
    var x = clientX == null ? rect.left + rect.width / 2 : clientX;
    var y = clientY == null ? rect.top + rect.height / 2 : clientY;
    var localX = x - rect.left;
    var localY = y - rect.top;
    var graphX = (localX - state.translateX) / state.scale;
    var graphY = (localY - state.translateY) / state.scale;
    var next = Math.min(2.5, Math.max(0.2, state.scale * factor));
    state.translateX = localX - graphX * next;
    state.translateY = localY - graphY * next;
    state.scale = next;
    updateTransform();
  }

  function graphCoordinates(event) {
    var rect = svg.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.translateX) / state.scale,
      y: (event.clientY - rect.top - state.translateY) / state.scale
    };
  }

  function beginNodeDrag(event) {
    event.stopPropagation();
    var id = event.currentTarget.getAttribute("data-node-id");
    var point = graphCoordinates(event);
    var position = state.positions.get(id);
    state.interaction = {
      type: "node",
      id: id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
      moved: false
    };
    svg.classList.add("is-dragging");
    svg.setPointerCapture(event.pointerId);
  }

  function beginPan(event) {
    if (event.button !== 0 || event.target.closest(".graph-node")) {
      return;
    }
    state.interaction = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.translateX,
      originY: state.translateY,
      moved: false
    };
    svg.classList.add("is-panning");
    svg.setPointerCapture(event.pointerId);
  }

  function movePointer(event) {
    var interaction = state.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    var deltaX = event.clientX - interaction.startX;
    var deltaY = event.clientY - interaction.startY;
    interaction.moved = interaction.moved || Math.abs(deltaX) + Math.abs(deltaY) > 4;

    if (interaction.type === "pan") {
      state.translateX = interaction.originX + deltaX;
      state.translateY = interaction.originY + deltaY;
      updateTransform();
      return;
    }

    var point = graphCoordinates(event);
    var position = state.positions.get(interaction.id);
    position.x = point.x - interaction.offsetX;
    position.y = point.y - interaction.offsetY;
    var element = nodesGroup.querySelector('[data-node-id="' + CSS.escape(interaction.id) + '"]');
    if (element) {
      element.setAttribute("transform", "translate(" + position.x + " " + position.y + ")");
    }
    updateEdgeGeometry();
  }

  function endPointer(event) {
    var interaction = state.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    if (interaction.type === "node" && !interaction.moved) {
      selectNode(interaction.id);
    }
    if (interaction.type === "pan" && !interaction.moved) {
      selectNode(null);
    }
    state.interaction = null;
    svg.classList.remove("is-panning", "is-dragging");
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  }

  function updateKindCounts() {
    document.querySelectorAll("[data-kind-count]").forEach(function (element) {
      var kind = element.getAttribute("data-kind-count");
      element.textContent = String(state.nodes.filter(function (node) { return node.kind === kind; }).length);
    });
  }

  function renderPackageCards() {
    packageGrid.replaceChildren();
    catalog.packages.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (pkg) {
      var card = document.createElement("article");
      card.className = "package-card";
      card.tabIndex = 0;
      card.setAttribute("data-package-name", pkg.name.toLowerCase());
      card.setAttribute("data-node-id", nodeId("package", pkg.name));
      var dependencyCount = ["build", "link", "runtime"].reduce(function (total, relation) {
        return total + (pkg.dependencies[relation] || []).length;
      }, 0);
      card.innerHTML = '<div class="package-card-top"><h3>' + escapeHtml(pkg.name) + '</h3><span class="package-version">' + escapeHtml(pkg.version) + '</span></div>' +
        '<p>' + escapeHtml(pkg.description) + '</p>' +
        '<div class="package-card-bottom"><span class="builder-tag">' + escapeHtml(pkg.builder) + '</span><span>' + dependencyCount + (dependencyCount === 1 ? " dependency" : " dependencies") + '</span></div>';
      card.addEventListener("click", function () { selectPackageFromCard(card); });
      card.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectPackageFromCard(card);
        }
      });
      packageGrid.appendChild(card);
    });
    filterPackageCards();
  }

  function selectPackageFromCard(card) {
    var id = card.getAttribute("data-node-id");
    if (!graphNodeById(id)) {
      state.view = "packages";
      viewFilter.value = "packages";
      rebuildGraph(true);
    }
    selectNode(id);
    document.querySelector(".graph-app").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function filterPackageCards() {
    var query = state.query.toLowerCase();
    var shown = 0;
    packageGrid.querySelectorAll(".package-card").forEach(function (card) {
      var pkg = packageMap.get(card.getAttribute("data-package-name"));
      var matches = !query || card.textContent.toLowerCase().includes(query) || (pkg && pkg.source.toLowerCase().includes(query));
      card.hidden = !matches;
      if (matches) { shown += 1; }
    });
    packageResultCount.textContent = shown + (shown === 1 ? " package" : " packages");
  }

  function rebuildGraph(shouldFit) {
    buildGraph();
    layoutGraph();
    renderGraph();
    renderInspector(state.selected ? graphNodeById(state.selected) : null);
    if (shouldFit) {
      requestAnimationFrame(fitGraph);
    } else {
      updateTransform();
    }
  }

  function setupControls() {
    var allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All systems";
    systemFilter.appendChild(allOption);
    catalog.systems.forEach(function (system) {
      var option = document.createElement("option");
      option.value = system.name;
      option.textContent = system.name;
      systemFilter.appendChild(option);
    });
    systemFilter.value = state.system;

    systemFilter.addEventListener("change", function () {
      state.system = systemFilter.value;
      state.selected = null;
      rebuildGraph(true);
    });

    viewFilter.addEventListener("change", function () {
      state.view = viewFilter.value;
      state.selected = null;
      rebuildGraph(true);
    });

    document.querySelectorAll("[data-kind-filter]").forEach(function (input) {
      input.addEventListener("change", function () {
        var kind = input.getAttribute("data-kind-filter");
        if (input.checked) {
          state.kinds.add(kind);
        } else {
          state.kinds.delete(kind);
        }
        rebuildGraph(true);
      });
    });

    document.querySelectorAll("[data-trace]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-trace]").forEach(function (other) { other.classList.remove("is-active"); });
        button.classList.add("is-active");
        state.trace = button.getAttribute("data-trace");
        updateHighlight();
      });
    });

    searchInput.addEventListener("input", function () {
      state.query = searchInput.value.trim();
      updateHighlight();
      filterPackageCards();
    });
    searchInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && state.query) {
        var active = activeNodes();
        var first = active && Array.from(active)[0];
        if (first) { selectNode(first); }
      }
      if (event.key === "Escape") {
        searchInput.value = "";
        state.query = "";
        selectNode(null);
        filterPackageCards();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "/" && document.activeElement !== searchInput && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        event.preventDefault();
        searchInput.focus();
      }
    });

    document.getElementById("fit-graph").addEventListener("click", fitGraph);
    document.getElementById("reset-graph").addEventListener("click", function () { rebuildGraph(true); });
    document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(1.22); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(0.82); });

    svg.addEventListener("pointerdown", beginPan);
    svg.addEventListener("pointermove", movePointer);
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);
    svg.addEventListener("wheel", function (event) {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
    }, { passive: false });

    window.addEventListener("resize", function () {
      window.clearTimeout(setupControls.resizeTimer);
      setupControls.resizeTimer = window.setTimeout(fitGraph, 120);
    });
  }

  setupControls();
  renderPackageCards();
  rebuildGraph(true);
}());
