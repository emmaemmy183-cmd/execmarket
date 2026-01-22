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
        a.dataset.postId = String(p.id);
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

      socket.on("post:closed", ({ post_id }) => {
        const el = document.querySelector(`[data-post-id="${String(post_id)}"]`);
        if (!el) return;
        const badges = el.querySelector(".badges");
        if (badges) badges.innerHTML = `<span class="badge role admin">Closed</span>`;
      });

      socket.on("post:reopened", ({ post_id }) => {
        const el = document.querySelector(`[data-post-id="${String(post_id)}"]`);
        if (!el) return;
        const badges = el.querySelector(".badges");
        if (badges) badges.innerHTML = ``;
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
          <div class="contentBox">${escapeHtml(r.body).replaceAll("\n", "<br/>")}</div>
        `;

        list.appendChild(wrap);
        wrap.scrollIntoView({ behavior: "smooth", block: "end" });
      });

      socket.on("post:closed", () => {
        setClosedUI(true);
      });

      socket.on("post:reopened", () => {
        setClosedUI(false);
      });
    }
  };

  document.head.appendChild(s);

  function setClosedUI(isClosed) {
    document.body.dataset.postClosed = isClosed ? "1" : "0";

    const banner = document.querySelector("#closedBanner");
    if (banner) banner.style.display = isClosed ? "block" : "none";

    const form = document.querySelector("#replyForm");
    if (form) form.style.display = isClosed ? "none" : "block";

    const lockedMsg = document.querySelector("#replyLockedMsg");
    if (lockedMsg) lockedMsg.style.display = isClosed ? "block" : "none";
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
