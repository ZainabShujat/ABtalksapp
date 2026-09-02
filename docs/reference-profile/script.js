/* ============================================================
   AB TALKS — Student Profile / Profile Completion
   State, navigation, completion, progress, persistence.
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "studentProfile";

  /* ----------------------------------------------------------
     1. Section data architecture
     ---------------------------------------------------------- */
  var profileSections = [
    {
      id: "basic",
      title: "Basic Information",
      description: "This is how you are introduced on the platform.",
      completed: false,
      type: "single",
      fields: [
        { name: "fullName", label: "Full name", required: true, placeholder: "Your full name", col: 6, badge: null },
        { name: "phone", label: "Phone", type: "tel", placeholder: "+91-XXXXXXXXXX", col: 6, badge: "Verified" },
        { name: "city", label: "City", placeholder: "e.g. Noida", col: 4 },
        { name: "state", label: "State / region", placeholder: "e.g. Uttar Pradesh", col: 4 },
        { name: "countryCode", label: "Country code", placeholder: "IN", col: 4, helper: "2 letters, e.g. IN", maxlength: 2 },
        { name: "headline", label: "Headline", placeholder: "ex: Final-year CSE student building ML systems", col: 12, helper: "One line. What you do, or what you are working toward." },
        { name: "resume", label: "Resume", kind: "file", col: 12,
          accept: ".pdf,.doc,.docx", maxSizeMB: 5,
          hint: "PDF or DOCX — up to 5 MB. Drop a file here or browse." },
        { name: "about", label: "About", kind: "textarea", col: 12, counter: 2000, placeholder: "Tell recruiters who you are." }
      ]
    },
    {
      id: "experience",
      title: "Experience",
      description: "Roles, Internships and freelance work.",
      completed: false,
      type: "repeat",
      entryLabel: "Role",
      addLabel: "+ Add More",
      fields: [
        { name: "company", label: "Company", required: true, placeholder: "e.g. Zunno AI", col: 6 },
        { name: "role", label: "Role", required: true, placeholder: "e.g. UI/UX Designer", col: 6 },
        { name: "employmentType", label: "Employment type", kind: "select", col: 6,
          options: ["Internship", "Full-time", "Part-time", "Freelance", "Contract", "Apprenticeship"] },
        { name: "location", label: "Location", placeholder: "e.g. Gurugram", col: 6 },
        { name: "current", label: "Currently working here", kind: "checkbox", col: 12 },
        { name: "start", label: "Starting from", kind: "monthyear", required: true, col: 6 },
        { name: "end", label: "Ending in", kind: "monthyear", required: true, col: 6, hideWhen: "current" },
        { name: "description", label: "Description", kind: "textarea", col: 12,
          placeholder: "What you owned, what you shipped, and the impact it had." }
      ]
    },
    {
      id: "education",
      title: "Education",
      description: "College, school, and any additional qualifications.",
      completed: false,
      type: "repeat",
      entryLabel: "Education",
      addLabel: "+ Add More",
      fields: [
        { name: "school", label: "School / College", required: true, placeholder: "e.g. Banasthali Vidyapith", col: 12 },
        { name: "degree", label: "Degree", placeholder: "e.g. B.Tech", col: 6 },
        { name: "department", label: "Department / field", placeholder: "e.g. Computer Science and Engineering", col: 6 },
        { name: "current", label: "Currently studying here", kind: "checkbox", col: 12 },
        { name: "start", label: "Starting from", kind: "monthyear", required: true, col: 6 },
        { name: "end", label: "Ending in", kind: "monthyear", required: true, col: 6, hideWhen: "current" },
        { name: "scoreType", label: "Score type", kind: "select", col: 6,
          options: ["CGPA_10", "CGPA_4", "PERCENTAGE", "GRADE"] },
        { name: "score", label: "Score", placeholder: "e.g. 7.9", col: 6 },
        { name: "description", label: "Description", kind: "textarea", col: 12,
          placeholder: "Coursework, thesis, societies, or anything else worth knowing." }
      ]
    },
    {
      id: "projects",
      title: "Projects",
      description: "Things you have built, with links a recruiter can open.",
      completed: false,
      type: "repeat",
      entryLabel: "Project",
      addLabel: "+ Add More",
      fields: [
        { name: "name", label: "Project name", required: true, placeholder: "e.g. Campus Ride Sharing App", col: 12 },
        { name: "description", label: "Description", kind: "textarea", col: 12,
          placeholder: "What it does, what was hard about it, and what you built yourself." },
        { name: "techStack", label: "Tech stack", kind: "tags", col: 12,
          placeholder: "ex: Next.js, Postgres",
          helper: "Descriptive only \u2014 this does not add to your skills." },
        { name: "github", label: "GitHub", type: "url", placeholder: "https://github.com/...", col: 6 },
        { name: "liveUrl", label: "Live URL", type: "url", placeholder: "https://www.example.com/", col: 6 }
      ]
    },
    {
      id: "mock",
      title: "Mock Interview",
      description: "Live AI interviews you have taken. Earned, not entered.",
      completed: false,
      type: "single",
      attention: true,
      fields: [
        { kind: "note", col: 12,
          text: "You haven\u2019t taken a mock interview yet. They are live voice interviews with an AI interviewer, and each one you finish keeps its own scored report." },
        { kind: "action", col: 12, label: "Take a mock interview", icon: "mic" }
      ]
    },
    {
      id: "skills",
      title: "Skills",
      description: "What you claim, kept separate from what the platform can verify.",
      completed: false,
      type: "single",
      fields: [
        { name: "skills", label: "Add a skill", kind: "tags", col: 12,
          placeholder: "Search for skills", noAddButton: true,
          helper: "Pick from the catalog so recruiters searching that skill can find you.",
          quickAdds: ["Python", "sql", "Java", "C++", "HTML", "CSS", "React", "JavaScript", "Excel", "js"],
          emptyText: "No skills yet. Add at least three." },
        { kind: "note", col: 12, muted: true,
          html: "Self-rating is your own assessment. <strong>Verified<\/strong> means the platform has recorded evidence \u2014 a passed activity, an assessment, a credential \u2014 and it is never inferred from what you rate yourself. Removing a skill withdraws the claim; any evidence behind it is kept." }
      ]
    },
    {
      id: "certifications",
      title: "Certifications",
      description: "External certifications you hold.",
      completed: false,
      type: "repeat",
      entryLabel: "Certification",
      addLabel: "+ Add More",
      intro: "External certifications only \u2014 AWS, Databricks, and the like. Anything ABTalks issued you already appears under Evidence & achievements.",
      fields: [
        { name: "name", label: "Name", required: true, placeholder: "e.g. UX Design", col: 6 },
        { name: "issuer", label: "Issuer", required: true, placeholder: "e.g. Google", col: 6 },
        { name: "issued", label: "Issued", kind: "monthyear", col: 6 },
        { name: "expires", label: "Expires", kind: "monthyear", col: 6 },
        { name: "credentialUrl", label: "Credential URL", type: "url", col: 12,
          placeholder: "https://www.credly.com/badges/..." }
      ]
    },
    {
      id: "links",
      title: "Links",
      description: "Where your work lives.",
      completed: false,
      type: "single",
      fields: [
        { name: "linkedin", label: "LinkedIn", type: "url", icon: "briefcase", col: 12,
          placeholder: "https://www.linkedin.com/in/username/" },
        { name: "github", label: "GitHub", type: "url", icon: "code", col: 12,
          placeholder: "https://github.com/username",
          helper: "Username or full profile URL \u2014 both are stored as your username." },
        { name: "portfolio", label: "Portfolio", type: "url", icon: "globe", col: 12,
          placeholder: "https://yoursite.com" },
        { name: "resume", label: "R\u00e9sum\u00e9", type: "url", icon: "file", col: 12,
          placeholder: "https://drive.google.com/...",
          helper: "Visible to you and admins. Recruiters see it only if you allow it." }
      ]
    },
    {
      id: "career",
      title: "Career Preferences",
      description: "What you are looking for. Separate from recruiter visibility.",
      completed: false,
      type: "single",
      fields: [
        { name: "openToWork", kind: "toggle", col: 12,
          title: "Open to work",
          text: "Says whether you are looking right now. Separate from whether recruiters can find you at all \u2014 this switch does not change that." },
        { name: "preferredRoles", label: "Preferred roles", kind: "tags", col: 12, placeholder: "ex: Backend Engineer" },
        { name: "preferredLocations", label: "Preferred locations", kind: "tags", col: 12, placeholder: "ex: Bangalore" },
        { name: "opportunityType", label: "Opportunity type", kind: "checkgroup", col: 12,
          options: ["Internship", "Full-time", "Part-time", "Contract", "Freelance"] },
        { name: "workMode", label: "Work mode", kind: "select", col: 6,
          options: ["On-site", "Hybrid", "Remote"] },
        { name: "noticePeriod", label: "Notice period", placeholder: "e.g. 10", col: 6,
          helper: "In days. Leave blank if you are immediately available." },
        { name: "availableFrom", label: "Available from", kind: "monthyear", col: 6 },
        { name: "willingToRelocate", label: "Willing to relocate", kind: "checkbox", col: 6, inline: true }
      ]
    },
    {
      id: "references",
      title: "References",
      description: "People who can vouch for your work.",
      completed: false,
      type: "repeat",
      attention: true,
      entryLabel: "Reference",
      addLabel: "+ Add More",
      fields: [
        { name: "name", label: "Full name", required: true, placeholder: "e.g. Ananya Rao", col: 6 },
        { name: "relationship", label: "Relationship", placeholder: "e.g. Design Manager at Zunno AI", col: 6 },
        { name: "email", label: "Email", type: "email", placeholder: "name@company.com", col: 6 },
        { name: "phone", label: "Phone", type: "tel", placeholder: "+91-XXXXXXXXXX", col: 6 },
        { name: "note", label: "Note", kind: "textarea", col: 12, placeholder: "Context for the recruiter." }
      ]
    }
  ];

  var TOTAL = profileSections.length;

  /* ----------------------------------------------------------
     2. State
     ---------------------------------------------------------- */
  var state = {
    currentSectionIndex: 0,
    completed: {},          // { sectionId: true }
    values: {},             // { sectionId: {..} | [{..},{..}] }
    celebrated: false
  };

  /* ----------------------------------------------------------
     3. DOM refs
     ---------------------------------------------------------- */
  var el = {
    checklist: document.getElementById("checklist"),
    body: document.getElementById("sectionBody"),
    title: document.getElementById("sectionTitle"),
    desc: document.getElementById("sectionDesc"),
    header: document.getElementById("sectionHeader"),
    progress: document.getElementById("sectionProgress"),
    ring: document.getElementById("ringFg"),
    ringWrap: document.querySelector(".ring-wrap"),
    ringCheck: document.getElementById("ringCheck"),
    pctNum: document.getElementById("pctNum"),
    pctBadge: document.getElementById("pctBadge"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    refillBtn: document.getElementById("refillBtn"),
    avatarEdit: document.getElementById("avatarEdit"),
    photoInput: document.getElementById("photoInput"),
    resetBtn: document.getElementById("resetBtn"),
    completePill: document.getElementById("completePill"),
    sidebar: document.getElementById("sidebar"),
    menuBtn: document.getElementById("mobileMenuBtn"),
    scrim: document.getElementById("scrim")
  };

  // ring geometry from Figma: 112 container, 100 track, r = 48.5
  var RING_CIRCUMFERENCE = 2 * Math.PI * 48.5;
  el.ring.style.strokeDasharray = RING_CIRCUMFERENCE;

  /* ----------------------------------------------------------
     4. Persistence
     ---------------------------------------------------------- */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentSectionIndex: state.currentSectionIndex,
        completed: state.completed,
        values: state.values,
        celebrated: state.celebrated
      }));
    } catch (e) { /* storage unavailable — run in memory */ }
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || typeof parsed !== "object") return;

    state.completed = parsed.completed && typeof parsed.completed === "object" ? parsed.completed : {};
    state.values = parsed.values && typeof parsed.values === "object" ? parsed.values : {};
    state.celebrated = !!parsed.celebrated;

    var idx = parseInt(parsed.currentSectionIndex, 10);
    state.currentSectionIndex = (isFinite(idx) && idx >= 0 && idx < TOTAL) ? idx : 0;

    profileSections.forEach(function (s) { s.completed = !!state.completed[s.id]; });
  }

  /* ----------------------------------------------------------
     5. Field rendering helpers
     ---------------------------------------------------------- */
  var MONTHS = ["1","2","3","4","5","6","7","8","9","10","11","12"];
  var YEARS = (function () {
    var out = [], y = new Date().getFullYear() + 6;
    for (var i = y; i >= 1975; i--) out.push(String(i));
    return out;
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fieldId(sectionId, entryIndex, name) {
    return "f_" + sectionId + "_" + entryIndex + "_" + name;
  }

  var ICONS = {
    mic: '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>'
  };

  function formatBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  /* Resume upload — click or drag-and-drop, with type and size checks.
     Only the file's name and size are persisted; the bytes stay in the page. */
  function buildFileField(section, field, entryIndex, value, wrap) {
    var saved = value && typeof value === "object" && value.name ? value : null;
    var id = fieldId(section.id, entryIndex, field.name);
    var maxBytes = (field.maxSizeMB || 5) * 1024 * 1024;

    var top = document.createElement("div");
    top.className = "field-top";
    top.innerHTML = "<label for='" + id + "'>" + esc(field.label) +
      (field.required ? '<span class="req">*</span>' : "") + "</label>";
    wrap.appendChild(top);

    var drop = document.createElement("div");
    drop.className = "file-drop";
    drop.dataset.name = field.name;
    drop.dataset.kind = "file";
    drop._file = saved;

    var input = document.createElement("input");
    input.type = "file";
    input.id = id;
    input.className = "file-input";
    if (field.accept) input.accept = field.accept;
    drop.appendChild(input);

    var body = document.createElement("div");
    body.className = "file-body";
    drop.appendChild(body);

    function renderEmpty() {
      drop.classList.remove("has-file");
      body.innerHTML =
        '<span class="file-icon">' + ICONS.upload + "</span>" +
        '<span class="file-copy"><span class="file-title">Upload your resume</span>' +
        '<span class="file-hint">' + esc(field.hint || "") + "</span></span>";
      var browse = document.createElement("button");
      browse.type = "button";
      browse.className = "file-browse";
      browse.textContent = "Browse";
      browse.addEventListener("click", function () { input.click(); });
      body.appendChild(browse);
    }

    function renderFile(f) {
      drop.classList.add("has-file");
      body.innerHTML =
        '<span class="file-icon file-icon-doc">' + ICONS.file + "</span>" +
        '<span class="file-copy"><span class="file-title">' + esc(f.name) + "</span>" +
        '<span class="file-hint">' + esc(formatBytes(f.size)) + " · uploaded</span></span>";

      var replace = document.createElement("button");
      replace.type = "button";
      replace.className = "file-browse";
      replace.textContent = "Replace";
      replace.addEventListener("click", function () { input.click(); });
      body.appendChild(replace);

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "file-remove";
      rm.setAttribute("aria-label", "Remove resume");
      rm.innerHTML = ICONS.close;
      rm.addEventListener("click", function () {
        drop._file = null;
        input.value = "";
        renderEmpty();
        persistCurrentValues();
      });
      body.appendChild(rm);
    }

    function showError(msg) {
      wrap.classList.add("has-error");
      var e = wrap.querySelector(".error-msg");
      if (e) e.textContent = msg;
    }

    function accept(fileList) {
      var f = fileList && fileList[0];
      if (!f) return;
      var okType = !field.accept || field.accept.split(",").some(function (ext) {
        return f.name.toLowerCase().endsWith(ext.trim().toLowerCase());
      });
      if (!okType) { showError("Use a PDF or DOCX file."); return; }
      if (f.size > maxBytes) {
        showError("That file is " + formatBytes(f.size) + ". The limit is " + field.maxSizeMB + " MB.");
        return;
      }
      wrap.classList.remove("has-error");
      drop._file = { name: f.name, size: f.size };
      renderFile(drop._file);
      persistCurrentValues();
    }

    input.addEventListener("change", function () { accept(input.files); });

    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        drop.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        drop.classList.remove("dragging");
      });
    });
    drop.addEventListener("drop", function (e) {
      accept(e.dataTransfer && e.dataTransfer.files);
    });

    if (saved) renderFile(saved); else renderEmpty();
    wrap.appendChild(drop);

    var err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "Add your resume.";
    wrap.appendChild(err);

    return wrap;
  }

  /* Chip input — used by Tech stack, Skills, Preferred roles / locations. */
  function buildTagsField(section, field, entryIndex, value, wrap) {
    var tags = Array.isArray(value) ? value.slice() : [];
    var id = fieldId(section.id, entryIndex, field.name);

    var top = document.createElement("div");
    top.className = "field-top";
    top.innerHTML = "<label for='" + id + "'>" + esc(field.label) +
      (field.required ? '<span class="req">*</span>' : "") + "</label>";
    wrap.appendChild(top);

    var store = document.createElement("div");
    store.dataset.name = field.name;
    store.dataset.kind = "tags";
    store._tags = tags;

    var inputRow = document.createElement("div");
    inputRow.className = "tag-input-row";
    var input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.placeholder = field.placeholder || "";
    inputRow.appendChild(input);

    var addBtn = null;
    if (!field.noAddButton) {
      addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tag-add";
      addBtn.setAttribute("aria-label", "Add");
      addBtn.innerHTML = ICONS.plus;
      inputRow.appendChild(addBtn);
    }
    store.appendChild(inputRow);

    if (field.helper) {
      var h = document.createElement("div");
      h.className = "helper";
      h.textContent = field.helper;
      store.appendChild(h);
    }

    var quick = null;
    if (field.quickAdds) {
      quick = document.createElement("div");
      quick.className = "quick-adds";
      quick.innerHTML = '<div class="quick-label">Quick adds</div>';
      var qrow = document.createElement("div");
      qrow.className = "quick-row";
      field.quickAdds.forEach(function (q) {
        var qb = document.createElement("button");
        qb.type = "button";
        qb.className = "quick-chip";
        qb.textContent = q;
        qb.addEventListener("click", function () { add(q); });
        qrow.appendChild(qb);
      });
      quick.appendChild(qrow);
      store.appendChild(quick);
    }

    var list = document.createElement("div");
    list.className = "tag-list" + (field.emptyText ? " tag-list-boxed" : "");
    store.appendChild(list);

    function render() {
      list.innerHTML = "";
      if (!tags.length && field.emptyText) {
        var em = document.createElement("div");
        em.className = "tag-empty";
        em.textContent = field.emptyText;
        list.appendChild(em);
        return;
      }
      tags.forEach(function (t, i) {
        var chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.innerHTML = "<span>" + esc(t) + "</span>";
        var x = document.createElement("button");
        x.type = "button";
        x.className = "tag-remove";
        x.setAttribute("aria-label", "Remove " + t);
        x.innerHTML = ICONS.close;
        x.addEventListener("click", function () {
          tags.splice(i, 1);
          store._tags = tags;
          render();
          fitBody();
        });
        chip.appendChild(x);
        list.appendChild(chip);
      });
    }

    function add(v) {
      v = String(v == null ? "" : v).trim();
      if (!v) return;
      if (tags.indexOf(v) === -1) tags.push(v);
      store._tags = tags;
      input.value = "";
      wrap.classList.remove("has-error");
      render();
      fitBody();
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); }
    });
    if (addBtn) addBtn.addEventListener("click", function () { add(input.value); });

    render();
    wrap.appendChild(store);

    var err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "Add at least one.";
    wrap.appendChild(err);

    return wrap;
  }

  function buildField(section, field, entryIndex, value) {
    var wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.field = field.name;

    if (field.kind === "checkbox") {
      wrap.className = field.inline ? "field field-inline-check" : "";
      var lbl = document.createElement("label");
      lbl.className = "checkbox";
      lbl.innerHTML =
        '<input type="checkbox" data-name="' + esc(field.name) + '"' + (value ? " checked" : "") + '>' +
        "<span>" + esc(field.label) + "</span>";
      wrap.appendChild(lbl);
      return wrap;
    }

    /* ---- static copy ---- */
    if (field.kind === "note") {
      wrap.className = "note" + (field.muted ? " note-muted" : "");
      if (field.html) wrap.innerHTML = field.html;
      else wrap.textContent = field.text || "";
      return wrap;
    }

    /* ---- standalone action button (not a form control) ---- */
    if (field.kind === "action") {
      wrap.className = "action-wrap";
      var act = document.createElement("button");
      act.type = "button";
      act.className = "btn-action";
      act.innerHTML = (field.icon === "mic" ? ICONS.mic : "") + "<span>" + esc(field.label) + "</span>";
      wrap.appendChild(act);
      return wrap;
    }

    /* ---- "Open to work" style switch panel ---- */
    if (field.kind === "toggle") {
      wrap.className = "toggle-panel";
      wrap.dataset.field = field.name;
      var tid = fieldId(section.id, entryIndex, field.name);
      wrap.innerHTML =
        '<div class="toggle-copy">' +
          '<div class="toggle-title">' + esc(field.title) + "</div>" +
          '<div class="toggle-text">' + esc(field.text) + "</div>" +
        "</div>" +
        '<label class="switch" for="' + tid + '">' +
          '<input type="checkbox" id="' + tid + '" data-name="' + esc(field.name) + '"' +
            (value ? " checked" : "") + ">" +
          "<span></span>" +
        "</label>";
      return wrap;
    }

    /* ---- row of checkboxes ---- */
    if (field.kind === "checkgroup") {
      var chosen = Array.isArray(value) ? value : [];
      var head = document.createElement("div");
      head.className = "field-top";
      head.innerHTML = "<label>" + esc(field.label) + "</label>";
      wrap.appendChild(head);

      var group = document.createElement("div");
      group.className = "checkgroup";
      group.dataset.name = field.name;
      group.dataset.kind = "checkgroup";
      (field.options || []).forEach(function (o) {
        var l = document.createElement("label");
        l.className = "checkbox";
        l.innerHTML =
          '<input type="checkbox" value="' + esc(o) + '"' +
          (chosen.indexOf(o) > -1 ? " checked" : "") + "><span>" + esc(o) + "</span>";
        group.appendChild(l);
      });
      wrap.appendChild(group);
      return wrap;
    }

    /* ---- chip input: type, press Enter or + to add ---- */
    if (field.kind === "tags") {
      return buildTagsField(section, field, entryIndex, value, wrap);
    }

    /* ---- resume upload ---- */
    if (field.kind === "file") {
      return buildFileField(section, field, entryIndex, value, wrap);
    }

    var id = fieldId(section.id, entryIndex, field.name);

    if (field.icon) {
      wrap.classList.add("field-linked");
      var ic = document.createElement("span");
      ic.className = "field-icon";
      ic.innerHTML = ICONS[field.icon] || "";
      wrap.appendChild(ic);
    }

    var top = document.createElement("div");
    top.className = "field-top";
    top.innerHTML =
      '<label for="' + id + '">' + esc(field.label) +
      (field.required ? '<span class="req">*</span>' : "") + "</label>" +
      (field.badge ? '<span class="verified">' + esc(field.badge) + "</span>" : "") +
      (field.counter ? '<span class="counter" data-counter>0/' + field.counter + "</span>" : "");
    wrap.appendChild(top);

    var control;

    if (field.kind === "monthyear") {
      control = document.createElement("div");
      control.className = "date-pair";
      var v = value && typeof value === "object" ? value : { month: "", year: "" };
      control.appendChild(makeSelect(id + "_m", field.name + ".month", MONTHS, v.month, "MM"));
      control.appendChild(makeSelect(id + "_y", field.name + ".year", YEARS, v.year, "YYYY"));
    } else if (field.kind === "select") {
      control = makeSelect(id, field.name, field.options || [], value, "Select");
    } else if (field.kind === "textarea") {
      wrap.classList.add("field--area");
      control = document.createElement("textarea");
      control.id = id;
      control.dataset.name = field.name;
      control.placeholder = field.placeholder || "";
      if (field.counter) control.maxLength = field.counter;
      control.value = value || "";
    } else {
      control = document.createElement("input");
      control.id = id;
      control.type = field.type || "text";
      control.dataset.name = field.name;
      control.placeholder = field.placeholder || "";
      if (field.maxlength) control.maxLength = field.maxlength;
      control.value = value || "";
    }

    wrap.appendChild(control);

    if (field.helper) {
      var h = document.createElement("div");
      h.className = "helper";
      h.textContent = field.helper;
      wrap.appendChild(h);
    }

    var err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "This field is required.";
    wrap.appendChild(err);

    // counter wiring
    if (field.counter) {
      var counterEl = top.querySelector("[data-counter]");
      var sync = function () {
        counterEl.textContent = control.value.length + "/" + field.counter;
      };
      control.addEventListener("input", sync);
      sync();
    }

    // filled styling like the reference (values give warm border)
    var markFilled = function (node) {
      if (node.value && node.value.length) node.classList.add("filled");
      else node.classList.remove("filled");
    };
    if (control.tagName === "INPUT" || control.tagName === "TEXTAREA") {
      markFilled(control);
      control.addEventListener("input", function () {
        markFilled(control);
        wrap.classList.remove("has-error");
        control.classList.remove("invalid");
      });
    } else {
      control.addEventListener("change", function () {
        wrap.classList.remove("has-error");
        Array.prototype.forEach.call(wrap.querySelectorAll(".invalid"), function (n) {
          n.classList.remove("invalid");
        });
      });
    }

    return wrap;
  }

  function makeSelect(id, name, options, value, placeholder) {
    var s = document.createElement("select");
    s.id = id;
    s.dataset.name = name;
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    s.appendChild(ph);
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      if (String(value) === String(o)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  /* group fields into rows by their `col` width (12-col grid) */
  function buildFieldGroup(section, entryIndex, values) {
    var frag = document.createDocumentFragment();
    var buffer = [];
    var bufferWidth = 0;

    function flush() {
      if (!buffer.length) return;
      var count = buffer.length;
      var row = document.createElement("div");
      row.className = "row cols-" + (count > 3 ? 3 : count);
      // a textarea row absorbs the card's spare height so nothing overflows
      if (section.type !== "repeat" && buffer.some(function (n) {
        return n.classList && n.classList.contains("field--area");
      })) row.classList.add("grow");
      buffer.forEach(function (n) { row.appendChild(n); });
      frag.appendChild(row);
      buffer = [];
      bufferWidth = 0;
    }

    section.fields.forEach(function (field) {
      var val = values ? values[field.name] : undefined;

      if (field.kind === "checkbox") {
        flush();
        frag.appendChild(buildField(section, field, entryIndex, val));
        return;
      }

      var w = field.col || 12;
      if (bufferWidth + w > 12) flush();
      buffer.push(buildField(section, field, entryIndex, val));
      bufferWidth += w;
      if (bufferWidth >= 12) flush();
    });

    flush();
    return frag;
  }

  /* ----------------------------------------------------------
     6. Section rendering
     ---------------------------------------------------------- */
  function renderSection() {
    var section = profileSections[state.currentSectionIndex];

    el.body.dataset.section = section.id;
    el.title.textContent = (state.currentSectionIndex + 1) + ". " + section.title;
    el.desc.textContent = section.description;
    el.body.innerHTML = "";

    if (section.type === "repeat") {
      var entries = state.values[section.id];
      if (!Array.isArray(entries) || !entries.length) entries = [{}];

      var container = document.createElement("div");
      container.className = "entries";
      container.dataset.repeat = "true";
      entries.forEach(function (vals, i) {
        container.appendChild(buildEntry(section, i, vals));
      });
      el.body.appendChild(container);

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "add-more";
      addBtn.textContent = section.addLabel || "+ Add More";
      addBtn.addEventListener("click", function () {
        container.appendChild(buildEntry(section, container.children.length, {}));
        renumberEntries(container, section);
        fitBody();
      });
      el.body.appendChild(addBtn);
    } else {
      el.body.appendChild(buildFieldGroup(section, 0, state.values[section.id] || {}));
    }

    if (section.intro) {
      var intro = document.createElement("div");
      intro.className = "section-intro";
      intro.textContent = section.intro;
      el.body.insertBefore(intro, el.body.firstChild);
    }

    applyConditionalFields();
    updateButtons();
    renderChecklist();
    updateSectionProgress();
    fitBody();
  }

  /* The card never scrolls. Only if dynamically added entries ("+ Add More")
     genuinely exceed the card do we let the body scroll, so nothing is clipped
     out of reach. The designed sections all fit as-is. */
  function fitBody() {
    el.body.classList.remove("scrollable");
    requestAnimationFrame(function () {
      if (el.body.scrollHeight > el.body.clientHeight + 1) {
        el.body.classList.add("scrollable");
      }
    });
  }

  function buildEntry(section, index, values) {
    var entry = document.createElement("div");
    entry.className = "entry";

    var head = document.createElement("div");
    head.className = "entry-head";
    head.innerHTML =
      '<div class="entry-title">' + esc(section.entryLabel || "Entry") + " " + (index + 1) + "</div>";

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "entry-remove";
    remove.setAttribute("aria-label", "Remove entry");
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.addEventListener("click", function () {
      var container = entry.parentNode;
      if (container.children.length === 1) {
        // keep at least one entry — clear it instead
        Array.prototype.forEach.call(entry.querySelectorAll("input, textarea, select"), function (n) {
          if (n.type === "checkbox") n.checked = false; else n.value = "";
          n.classList.remove("filled", "invalid");
        });
        applyConditionalFields();
        return;
      }
      container.removeChild(entry);
      renumberEntries(container, section);
      fitBody();
    });
    head.appendChild(remove);
    entry.appendChild(head);

    entry.appendChild(buildFieldGroup(section, index, values || {}));
    return entry;
  }

  function renumberEntries(container, section) {
    Array.prototype.forEach.call(container.children, function (child, i) {
      var t = child.querySelector(".entry-title");
      if (t) t.textContent = (section.entryLabel || "Entry") + " " + (i + 1);
    });
    applyConditionalFields();
  }

  /* "Ending in" hides when "Currently working here" is ticked */
  function applyConditionalFields() {
    var section = profileSections[state.currentSectionIndex];
    var scopes = section.type === "repeat"
      ? Array.prototype.slice.call(el.body.querySelectorAll(".entry"))
      : [el.body];

    section.fields.forEach(function (field) {
      if (!field.hideWhen) return;
      scopes.forEach(function (scope) {
        var trigger = scope.querySelector('input[type=checkbox][data-name="' + field.hideWhen + '"]');
        var target = scope.querySelector('.field[data-field="' + field.name + '"]');
        if (!trigger || !target) return;
        var hide = trigger.checked;
        target.style.visibility = hide ? "hidden" : "";
        target.style.pointerEvents = hide ? "none" : "";
        if (!trigger.dataset.bound) {
          trigger.dataset.bound = "1";
          trigger.addEventListener("change", applyConditionalFields);
        }
      });
    });
  }

  /* ----------------------------------------------------------
     7. Reading + validating the current section
     ---------------------------------------------------------- */
  function readScope(section, scope) {
    var out = {};
    section.fields.forEach(function (field) {
      if (!field.name) return;                      // note / action blocks

      if (field.kind === "monthyear") {
        var m = scope.querySelector('[data-name="' + field.name + '.month"]');
        var y = scope.querySelector('[data-name="' + field.name + '.year"]');
        out[field.name] = { month: m ? m.value : "", year: y ? y.value : "" };
        return;
      }

      var node = scope.querySelector('[data-name="' + field.name + '"]');
      if (!node) return;

      if (node.dataset.kind === "tags") {
        out[field.name] = (node._tags || []).slice();
        return;
      }
      if (node.dataset.kind === "file") {
        out[field.name] = node._file || null;
        return;
      }
      if (node.dataset.kind === "checkgroup") {
        out[field.name] = Array.prototype.slice
          .call(node.querySelectorAll("input:checked"))
          .map(function (n) { return n.value; });
        return;
      }
      out[field.name] = node.type === "checkbox" ? node.checked : node.value;
    });
    return out;
  }

  function collectValues() {
    var section = profileSections[state.currentSectionIndex];
    if (section.type === "repeat") {
      var entries = Array.prototype.slice.call(el.body.querySelectorAll(".entry"));
      return entries.map(function (entry) { return readScope(section, entry); });
    }
    return readScope(section, el.body);
  }

  function validateCurrent() {
    var section = profileSections[state.currentSectionIndex];
    var scopes = section.type === "repeat"
      ? Array.prototype.slice.call(el.body.querySelectorAll(".entry"))
      : [el.body];

    var firstBad = null;

    scopes.forEach(function (scope) {
      section.fields.forEach(function (field) {
        if (!field.required) return;

        var wrap = scope.querySelector('.field[data-field="' + field.name + '"]');
        if (!wrap) return;
        if (wrap.style.visibility === "hidden") return; // conditionally hidden

        var nodes, empty;
        if (field.kind === "file") {
          var fnode = scope.querySelector('[data-name="' + field.name + '"]');
          if (fnode && !fnode._file) {
            wrap.classList.add("has-error");
            if (!firstBad) firstBad = fnode.querySelector(".file-browse");
          } else {
            wrap.classList.remove("has-error");
          }
          return;
        }
        if (field.kind === "tags") {
          var store = scope.querySelector('[data-name="' + field.name + '"]');
          if (store && !(store._tags || []).length) {
            wrap.classList.add("has-error");
            if (!firstBad) firstBad = store.querySelector("input");
          } else {
            wrap.classList.remove("has-error");
          }
          return;
        }
        if (field.kind === "monthyear") {
          nodes = [
            scope.querySelector('[data-name="' + field.name + '.month"]'),
            scope.querySelector('[data-name="' + field.name + '.year"]')
          ].filter(Boolean);
          empty = nodes.some(function (n) { return !n.value; });
        } else {
          nodes = [scope.querySelector('[data-name="' + field.name + '"]')].filter(Boolean);
          empty = nodes.some(function (n) { return !String(n.value).trim(); });
        }

        if (empty) {
          wrap.classList.add("has-error");
          nodes.forEach(function (n) { if (!n.value) n.classList.add("invalid"); });
          if (!firstBad) firstBad = nodes[0];
        } else {
          wrap.classList.remove("has-error");
          nodes.forEach(function (n) { n.classList.remove("invalid"); });
        }
      });
    });

    if (firstBad) {
      firstBad.focus();
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function persistCurrentValues() {
    var section = profileSections[state.currentSectionIndex];
    state.values[section.id] = collectValues();
    saveState();
  }

  /* ----------------------------------------------------------
     8. Checklist
     ---------------------------------------------------------- */
  /* Figma icon set (18 x 18) — check-circle-2 and alert-triangle */
  function checkIconMarkup() {
    return '<span class="mark"><svg viewBox="0 0 24 24">' +
      '<circle class="disc" cx="12" cy="12" r="10"></circle>' +
      '<path class="tick" d="m9 12 2 2 4-4" fill="none"></path>' +
      "</svg></span>";
  }

  function warnIconMarkup() {
    return '<span class="mark"><svg viewBox="0 0 24 24">' +
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>' +
      '<path d="M12 9v4"></path><path d="M12 17h.01"></path>' +
      "</svg></span>";
  }

  function renderChecklist() {
    el.checklist.innerHTML = "";
    profileSections.forEach(function (section, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "check-item";
      if (section.completed) btn.classList.add("completed");
      else if (section.attention) btn.classList.add("attention");
      if (i === state.currentSectionIndex) btn.classList.add("current");

      btn.innerHTML =
        (section.completed || !section.attention ? checkIconMarkup() : warnIconMarkup()) +
        "<span>" + esc(section.title) + "</span>";

      btn.addEventListener("click", function () {
        // free navigation — does NOT mark anything complete
        persistCurrentValues();
        state.currentSectionIndex = i;
        saveState();
        renderSection();
        closeSidebar();
      });

      li.appendChild(btn);
      el.checklist.appendChild(li);
    });
  }

  /* ----------------------------------------------------------
     9. Completion percentage (single source of truth)
     ---------------------------------------------------------- */
  function updateProfileCompletion() {
    var completed = profileSections.filter(function (s) { return s.completed; }).length;
    var percentage = Math.round((completed / TOTAL) * 100);
    updateCircularProgress(percentage);
    updateCompletionBadge(percentage);
    return percentage;
  }

  function updateCircularProgress(percentage) {
    var offset = RING_CIRCUMFERENCE * (1 - percentage / 100);
    el.ring.style.strokeDashoffset = offset;
  }

  function updateCompletionBadge(percentage) {
    el.pctNum.textContent = percentage + "%";
    el.pctBadge.classList.toggle("full", percentage === 100);
    el.ringCheck.classList.toggle("show", percentage === 100);
  }

  /* ----------------------------------------------------------
     10. Header progress — completion-driven, not navigation-driven
     ---------------------------------------------------------- */
  /* Purely completion-driven. 0 completed => 0% => the header stays white.
     Opening a section never fills the bar; only Next/Save does. */
  function updateSectionProgress() {
    var completed = profileSections.filter(function (s) { return s.completed; }).length;
    var progress = (completed / TOTAL) * 100;
    el.progress.style.width = progress + "%";
  }

  /* ----------------------------------------------------------
     11. Final completion animation
     ---------------------------------------------------------- */
  function runCompletionCelebration() {
    el.progress.classList.remove("finished");
    void el.progress.offsetWidth; // restart animation
    el.progress.classList.add("finished");

    el.ringWrap.classList.remove("celebrate");
    void el.ringWrap.offsetWidth;
    el.ringWrap.classList.add("celebrate");

    setTimeout(function () { el.completePill.classList.add("show"); }, 500);
  }

  function applyCompletedVisualState() {
    // restored 100% state on reload — no replay of the animation
    el.progress.style.background = "#FFF7ED";
    el.progress.style.boxShadow = "0 0 18px rgba(241,90,58,.14)";
    el.completePill.classList.add("show");
  }

  /* ----------------------------------------------------------
     12. Navigation
     ---------------------------------------------------------- */
  function isLast() { return state.currentSectionIndex === TOTAL - 1; }

  function updateButtons() {
    el.prevBtn.disabled = state.currentSectionIndex === 0;
    if (isLast()) {
      el.nextBtn.textContent = "Save";
      el.nextBtn.classList.add("save");
    } else {
      el.nextBtn.textContent = "Next";
      el.nextBtn.classList.remove("save");
    }
  }

  function handleNext() {
    if (!validateCurrent()) return;

    var section = profileSections[state.currentSectionIndex];

    persistCurrentValues();

    // mark completed — only Next/Save does this
    section.completed = true;
    state.completed[section.id] = true;

    var pct = updateProfileCompletion();
    renderChecklist();

    if (isLast()) {
      updateSectionProgress();
      if (pct === 100) {
        state.celebrated = true;
        runCompletionCelebration();
      }
      saveState();
      return;
    }

    state.currentSectionIndex += 1;
    saveState();
    renderSection();
  }

  function handlePrev() {
    if (state.currentSectionIndex === 0) return;
    persistCurrentValues();               // keep typed values
    state.currentSectionIndex -= 1;       // completion state untouched
    saveState();
    renderSection();
  }

  /* ----------------------------------------------------------
     12b. Testing helpers — "Refill Complete Form" / "Reset"
     ---------------------------------------------------------- */
  var SAMPLE_DATA = {
    basic: {
      fullName: "Shallika Seth",
      phone: "+91-7081441088",
      city: "Noida",
      state: "Uttar Pradesh",
      countryCode: "IN",
      headline: "UI/UX Designer crafting calm, usable product interfaces",
      resume: { name: "Shallika-Seth-Resume.pdf", size: 284160 },
      about: "I am a creative and curious individual, which keeps me open minded and excited to understand things better. I have been passionate about design and art from a very young age. I believe in progress instead of perfection, and that has been my motto. I work well both on my own and within a team, and I enjoy turning messy problems into clear, usable interfaces."
    },
    experience: [
      {
        company: "Zunno AI", role: "UI/UX Designer", employmentType: "Internship",
        location: "Gurugram", current: false,
        start: { month: "7", year: "2025" }, end: { month: "12", year: "2025" },
        description: "Owned the design of the onboarding and billing flows end to end. Shipped a component library that cut new-screen build time roughly in half, and ran usability sessions that lifted activation."
      },
      {
        company: "Bigbets Studio", role: "Product Design Intern", employmentType: "Freelance",
        location: "Remote", current: false,
        start: { month: "1", year: "2025" }, end: { month: "6", year: "2025" },
        description: "Redesigned the marketing site and design system tokens for three client brands."
      }
    ],
    education: [
      {
        school: "Banasthali Vidyapith", degree: "B.Tech",
        department: "Computer Science and Engineering", current: false,
        start: { month: "7", year: "2022" }, end: { month: "5", year: "2026" },
        scoreType: "CGPA_10", score: "7.9",
        description: "Coursework in HCI, data structures and design systems. Led the campus design society for two years."
      }
    ],
    projects: [
      {
        name: "Mahrea",
        description: "A marketplace for independent makers. I built the catalogue, the checkout flow and the seller dashboard, and the hard part was keeping inventory consistent across concurrent orders.",
        techStack: ["Next.js", "Postgres", "Tailwind"],
        github: "https://github.com/shallika/mahrea",
        liveUrl: "https://www.mahrea.com/"
      }
    ],
    mock: {},
    skills: {
      skills: ["Python", "React", "HTML", "CSS", "JavaScript", "Figma"]
    },
    certifications: [
      {
        name: "UX Design", issuer: "Google",
        issued: { month: "12", year: "2025" }, expires: { month: "", year: "" },
        credentialUrl: "https://www.credly.com/badges/a5639597-9e09-411b-b0b4-f9fb56305b51/linked_in_profile"
      }
    ],
    links: {
      linkedin: "https://www.linkedin.com/in/shallika-seth-740498255/",
      github: "https://github.com/shallika",
      portfolio: "https://shallikasethdesigns.vercel.app/index.html",
      resume: "https://drive.google.com/file/d/1a2b3c4d5e/view"
    },
    career: {
      openToWork: true,
      preferredRoles: ["Product Designer", "Frontend Engineer"],
      preferredLocations: ["Bangalore", "Remote"],
      opportunityType: ["Full-time"],
      workMode: "Hybrid",
      noticePeriod: "10",
      availableFrom: { month: "1", year: "2026" },
      willingToRelocate: true
    },
    references: [
      {
        name: "Ananya Rao", relationship: "Design Manager at Zunno AI",
        email: "ananya.rao@zunno.ai", phone: "+91-9810045512",
        note: "Managed me directly through the onboarding redesign. Happy to speak to process and collaboration."
      }
    ]
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Fills every section with sample data, marks the profile complete and
     plays the full completion sequence — the whole flow in one click. */
  function refillCompleteForm() {
    state.values = clone(SAMPLE_DATA);
    profileSections.forEach(function (s) {
      s.completed = true;
      state.completed[s.id] = true;
    });
    state.currentSectionIndex = TOTAL - 1;
    state.celebrated = true;
    saveState();

    renderSection();
    updateProfileCompletion();
    runCompletionCelebration();
  }

  /* Clears everything and returns to the initial (white header) state. */
  function resetForm() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PHOTO_KEY);
    } catch (e) { /* ignore */ }
    Array.prototype.forEach.call(document.querySelectorAll(".avatar"), function (n) {
      n.style.backgroundImage = "";
    });

    state.values = {};
    state.completed = {};
    state.currentSectionIndex = 0;
    state.celebrated = false;
    profileSections.forEach(function (s) { s.completed = false; });

    el.progress.classList.remove("finished");
    el.progress.style.background = "";
    el.progress.style.boxShadow = "";
    el.completePill.classList.remove("show");
    el.ringWrap.classList.remove("celebrate");

    saveState();
    renderSection();
    updateProfileCompletion();
  }

  /* ----------------------------------------------------------
     12c. Profile photo — the pencil on the avatar
     ---------------------------------------------------------- */
  var PHOTO_KEY = "studentProfilePhoto";
  var PHOTO_BOX = 240;                  // stored square, keeps localStorage small

  function applyPhoto(dataUrl) {
    if (!dataUrl) return;
    Array.prototype.forEach.call(document.querySelectorAll(".avatar"), function (n) {
      n.style.backgroundImage = "url(" + dataUrl + ")";
    });
  }

  function loadPhoto() {
    try { applyPhoto(localStorage.getItem(PHOTO_KEY)); } catch (e) { /* ignore */ }
  }

  /* Downscale to a 240px square before storing — a full-size photo would
     blow the localStorage quota. */
  function handlePhotoFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;

        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = PHOTO_BOX;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_BOX, PHOTO_BOX);

        var out = canvas.toDataURL("image/jpeg", 0.85);
        applyPhoto(out);
        try { localStorage.setItem(PHOTO_KEY, out); } catch (e) { /* quota — keep it in the page */ }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  if (el.avatarEdit && el.photoInput) {
    el.avatarEdit.addEventListener("click", function () { el.photoInput.click(); });
    el.photoInput.addEventListener("change", function () {
      handlePhotoFile(el.photoInput.files && el.photoInput.files[0]);
      el.photoInput.value = "";
    });
  }

  /* ----------------------------------------------------------
     13. Mobile sidebar
     ---------------------------------------------------------- */
  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.scrim.classList.remove("show");
  }
  el.menuBtn.addEventListener("click", function () {
    var open = el.sidebar.classList.toggle("open");
    el.scrim.classList.toggle("show", open);
  });
  el.scrim.addEventListener("click", closeSidebar);

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitBody, 120);
  });

  /* ----------------------------------------------------------
     14. Boot
     ---------------------------------------------------------- */
  el.nextBtn.addEventListener("click", handleNext);
  el.prevBtn.addEventListener("click", handlePrev);
  if (el.refillBtn) el.refillBtn.addEventListener("click", refillCompleteForm);
  if (el.resetBtn) el.resetBtn.addEventListener("click", resetForm);
  window.addEventListener("beforeunload", persistCurrentValues);

  loadState();
  loadPhoto();
  renderSection();

  // animate the ring in from 0 on first paint
  updateCircularProgress(0);
  updateCompletionBadge(0);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var pct = updateProfileCompletion();
      if (pct === 100 && state.celebrated) applyCompletedVisualState();
    });
  });
})();
