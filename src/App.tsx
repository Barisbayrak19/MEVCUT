import { useState } from "react";

const stats = [
  { label: "Bugünkü Yoklama", value: "0", icon: "✓" },
  { label: "Bekleyen", value: "0", icon: "◷" },
  { label: "İşlenen", value: "0", icon: "↗" },
  { label: "Hata", value: "0", icon: "!" },
];

export default function App() {
  const [active, setActive] = useState("Ana Sayfa");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MEVCUT</strong>
            <span>Yoklama Sistemi</span>
          </div>
        </div>

        <nav>
          {["Ana Sayfa", "Yoklama", "Geçmiş", "e-Okul Aktarım", "Ayarlar"].map((item) => (
            <button
              key={item}
              className={active === item ? "nav-item active" : "nav-item"}
              onClick={() => setActive(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">MVP 0.1</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">DİJİTAL YOKLAMA</p>
            <h1>{active}</h1>
          </div>
          <div className="user-chip">Yönetici</div>
        </header>

        <section className="welcome-card">
          <div>
            <p className="eyebrow">MEVCUT</p>
            <h2>Yoklamayı tek yerden yönet.</h2>
            <p>Öğretmen yoklamayı girer, okul yönetimi takip eder, e-Okul'a aktarım köprü üzerinden yapılır.</p>
          </div>
          <button className="primary" onClick={() => setActive("Yoklama")}>Yoklamaya Başla →</button>
        </section>

        <section className="stats-grid">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <div className="stat-icon">{stat.icon}</div>
              <div><span>{stat.label}</span><strong>{stat.value}</strong></div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div><h3>Bugünkü işlemler</h3><p>Henüz kayıt bulunmuyor.</p></div>
            <span className="status-badge">Hazır</span>
          </div>
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            <strong>İlk yoklamanı oluştur</strong>
            <p>MEVCUT'un ilk çalışan modülü burada başlayacak.</p>
            <button className="secondary" onClick={() => setActive("Yoklama")}>Yoklama ekranını aç</button>
          </div>
        </section>
      </main>
    </div>
  );
}
