const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

let thinkingEl = null;
let activeUndoButton = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function addMessage(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setInputEnabled(enabled) {
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

function clearUndoButton() {
  if (activeUndoButton) {
    activeUndoButton.remove();
    activeUndoButton = null;
  }
}

function addUndoButton() {
  clearUndoButton(); // only the most recent run is ever actually undoable

  const btn = document.createElement("button");
  btn.className = "undo-btn";
  btn.textContent = "Undo last organize";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Undoing...";
    const res = await window.deskmate.undoLastOrganize();

    if (res.ok && res.result.undone) {
      addMessage(
        `Undone — moved ${res.result.run.moves.length} item(s) back to where they were.`,
        "deskmate"
      );
    } else {
      addMessage(res.ok ? res.result.reason : `Undo failed: ${res.error}`, "deskmate");
    }
    clearUndoButton();
  });

  messagesEl.appendChild(btn);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  activeUndoButton = btn;
}

// The plan preview card: grouped by category, with Yes/Cancel. Clicking
// either just reports the decision back over IPC — the actual validation
// and execution already happened (or will happen) entirely in the engine;
// this button is only a nicer version of typing "yes" at the terminal
// prompt, never a shortcut around it.
function renderPlanPreview(moves) {
  const card = document.createElement("div");
  card.className = "msg deskmate plan-card";

  const byCategory = new Map();
  for (const m of moves) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m.name);
    byCategory.set(m.category, list);
  }

  let html = `<div class="plan-title">Proposed plan — ${moves.length} item(s)</div>`;
  for (const [category, names] of byCategory) {
    html += `<div class="plan-category">${escapeHtml(category)} (${names.length})</div><ul class="plan-list">`;
    for (const name of names) html += `<li>${escapeHtml(name)}</li>`;
    html += `</ul>`;
  }
  html += `
    <div class="plan-actions">
      <button class="plan-yes">Yes, do it</button>
      <button class="plan-cancel">Cancel</button>
    </div>
  `;
  card.innerHTML = html;

  const actions = card.querySelector(".plan-actions");
  card.querySelector(".plan-yes").addEventListener("click", () => {
    actions.remove();
    addMessage("Moving files...", "deskmate");
    window.deskmate.confirmOrganize(true);
  });
  card.querySelector(".plan-cancel").addEventListener("click", () => {
    actions.remove();
    window.deskmate.confirmOrganize(false);
  });

  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOrganizeOutcome(result) {
  switch (result.status) {
    case "invalid":
      addMessage(`I couldn't come up with a safe plan:\n${result.errors.join("\n")}`, "deskmate");
      break;
    case "nothing-to-do":
      addMessage("Your Desktop already looks organized — nothing to move.", "deskmate");
      break;
    case "cancelled":
      addMessage("Cancelled — nothing was changed.", "deskmate");
      break;
    case "done":
      addMessage(result.deskReport, "deskmate");
      addUndoButton();
      break;
    case "error":
      addMessage(
        `Organize failed partway through and was rolled back — nothing was changed.\n` +
          `Reason: ${result.error}\n` +
          "(Usually Windows blocking a move because something else has that file/folder open.)",
        "deskmate"
      );
      break;
  }
}

function renderUndoOutcome(result) {
  clearUndoButton();
  if (result.undone) {
    addMessage(`Undone — moved ${result.run.moves.length} item(s) back to where they were.`, "deskmate");
  } else {
    addMessage(result.reason, "deskmate");
  }
}

// Arrives mid-flight, while the chat:send call from send() below is still
// pending — that's expected, it's how the organize confirmation round-trip
// works (see electron/main.js).
window.deskmate.onOrganizePreview((moves) => {
  if (thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }
  renderPlanPreview(moves);
});

// Fires when "Undo last organize" is used from the tray's right-click menu
// instead of the in-window button — same outcome message either way.
window.deskmate.onUndoResult((result) => {
  renderUndoOutcome(result);
});

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";
  setInputEnabled(false);

  thinkingEl = addMessage("…", "deskmate");

  const result = await window.deskmate.sendMessage(text);

  if (thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }

  if (!result.ok) {
    addMessage(`Something went wrong: ${result.error}`, "deskmate");
  } else if (result.kind === "chat") {
    addMessage(result.reply, "deskmate");
  } else if (result.kind === "organize") {
    renderOrganizeOutcome(result.result);
  } else if (result.kind === "undo") {
    renderUndoOutcome(result.result);
  }

  setInputEnabled(true);
  inputEl.focus();
}

sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});
