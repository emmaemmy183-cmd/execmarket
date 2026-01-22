// public/app.js
// Simple "page ready" class to trigger smoother transitions if you extend later.
// document.documentElement.classList.add("js");

// public/app.js
(() => {
  const s = document.createElement("script");
  s.src = "/socket.io/socket.io.js";
  s.defer = true;

  s.onload = () => {
    const socket = io();

    // category page
    const categoryKey = document.body.dataset.categoryKey;
    if (categoryKey) {
      socket.emit("join:category", categoryKey);

      socket.on("post:new", (p) => {
        const list = document.querySelector("#livePosts");
        if (!list) return;

        const a = document.createElement("a");
        a.className = "postItem lift cardAnim";
        a.href = `/p/${p.id}`;
        a.innerHTML = `
          <div class="postTop">
            <div class="postTitle">${escapeHtml(p.title)}</div>
            <div class="badges"><span class="badge role neutral">New</span></div>
          </div>
          <div class="postMeta">
            <span class="muted">@${escapeHtml(p.author)}</span>
            <span class="dot">•</span>
            <span class="muted">${new Date(p.created_at * 1000).toLocaleString()}</span>
          </div>
        `;
        list.prepend(a);
      });
    }

    // post page
    const postId = document.body.dataset.postId;
    if (postId) {
      socket.emit("join:post", postId);

      socket.on("reply:new", (r) => {
        const list = document.querySelector("#liveReplies");
        if (!list) return;

        const wrap = document.createElement("div");
        wrap.className = "reply cardAnim";
        wrap.innerHTML = `
          <div class="replyHead">
            <span class="muted">@${escapeHtml(r.author)}</span>
            <span class="dot">•</span>
            <span class="muted">${new Date(r.created_at * 1000).toLocaleString()}</span>
            <span class="dot">•</span>
            <span class="badges"><span class="badge role neutral">New</span></span>
          </div>
          <div class="contentBox">${escapeHtml(r.body).replaceAll("\n","<br/>")}</div>
        `;

        list.appendChild(wrap);
        wrap.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  };

  document.head.appendChild(s);

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
