async function load() {
  const q = document.getElementById("search").value.trim();
  const url = "/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : "");
  const res = await fetch(url);
  const data = await res.json();
  const body = document.getElementById("tableBody");
  document.getElementById("meta").textContent = data.ok
    ? `${data.total} accounts · ${data.persist}`
    : (data.error || "Failed");
  body.innerHTML = (data.data || []).map((r) => `
    <tr>
      <td>${r.username || ""}</td>
      <td>${r.phone || ""}</td>
      <td>${r.email || ""}</td>
      <td>${r.password || ""}</td>
      <td>${r.balance || 0}</td>
      <td>${r.bonusBalance || 0}</td>
      <td>${r.displayTime || ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">No accounts yet</td></tr>`;
}

document.getElementById("refresh").onclick = load;
document.getElementById("search").addEventListener("input", () => {
  clearTimeout(window._t);
  window._t = setTimeout(load, 250);
});
load();
