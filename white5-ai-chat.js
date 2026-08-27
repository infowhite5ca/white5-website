(() => {
  if (window.__white5AiChatLoaded) return;
  window.__white5AiChatLoaded = true;

  const STORAGE_KEY = "white5-ai-chat-v3";
  const MAX_HISTORY = 12;
  const MAX_IMAGES = 4;
  const MAX_ORIGINAL_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_COMPRESSED_BYTES = 900 * 1024;
  const MAX_DIMENSION = 1400;
  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

  const root = document.createElement("div");
  root.id = "white5-ai-chat-root";
  root.innerHTML = `
    <button class="white5-ai-launcher" type="button" aria-expanded="false" aria-controls="white5-ai-panel">
      <span class="white5-ai-launcher-icon" aria-hidden="true">AI</span>
      <span>Get a quick quote</span>
    </button>
    <section class="white5-ai-panel" id="white5-ai-panel" aria-label="White5 AI chat" aria-hidden="true">
      <header class="white5-ai-header">
        <div class="white5-ai-brand">
          <div class="white5-ai-avatar" aria-hidden="true">W5</div>
          <div>
            <div class="white5-ai-title">White5 Quick Quote</div>
            <div class="white5-ai-subtitle"><span class="white5-ai-dot"></span>Available now</div>
          </div>
        </div>
        <button class="white5-ai-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="white5-ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="white5-ai-quick" aria-label="Suggested questions">
        <button type="button" data-message="I need a quick quote.">Quick quote</button>
        <button type="button" data-message="I need window cleaning.">Windows</button>
        <button type="button" data-message="I need gutter or eavestrough cleaning.">Eavestroughs</button>
        <button type="button" data-message="I need help with a deck or fence project.">Deck & fence</button>
      </div>
      <div class="white5-ai-compose">
        <div class="white5-ai-attachments" aria-label="Selected photos" hidden></div>
        <div class="white5-ai-attachment-status" role="status" aria-live="polite"></div>
        <div class="white5-ai-contact" aria-label="Optional contact details">
          <input class="white5-ai-contact-name" type="text" maxlength="100" autocomplete="name" placeholder="Name (optional)" aria-label="Name (optional)">
          <input class="white5-ai-contact-email" type="email" maxlength="254" autocomplete="email" inputmode="email" placeholder="Email (optional)" aria-label="Email (optional)">
          <input class="white5-ai-contact-phone" type="tel" maxlength="40" autocomplete="tel" inputmode="tel" placeholder="Phone (optional)" aria-label="Phone (optional)">
        </div>
        <form class="white5-ai-form">
          <button class="white5-ai-attach" type="button" aria-label="Add photos" title="Add up to 4 photos">📎</button>
          <input class="white5-ai-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
          <textarea class="white5-ai-input" rows="1" maxlength="1400" placeholder="Describe the job or add a photo…" aria-label="Your message"></textarea>
          <button class="white5-ai-send" type="submit" aria-label="Send message">➜</button>
        </form>
        <div class="white5-ai-actions">
          <a href="/services.html#estimate">Get Quote</a>
          <a href="tel:14034793905">Call 403-479-3905</a>
        </div>
        <div class="white5-ai-note">Contact details are optional. Photos, your message, and any contact details you provide are emailed to White5 for follow-up. Don’t upload IDs or payment information.</div>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  const launcher = root.querySelector(".white5-ai-launcher");
  const panel = root.querySelector(".white5-ai-panel");
  const closeButton = root.querySelector(".white5-ai-close");
  const messagesElement = root.querySelector(".white5-ai-messages");
  const form = root.querySelector(".white5-ai-form");
  const input = root.querySelector(".white5-ai-input");
  const sendButton = root.querySelector(".white5-ai-send");
  const attachButton = root.querySelector(".white5-ai-attach");
  const fileInput = root.querySelector(".white5-ai-file-input");
  const attachmentsElement = root.querySelector(".white5-ai-attachments");
  const attachmentStatus = root.querySelector(".white5-ai-attachment-status");
  const contactName = root.querySelector(".white5-ai-contact-name");
  const contactEmail = root.querySelector(".white5-ai-contact-email");
  const contactPhone = root.querySelector(".white5-ai-contact-phone");
  const contactInputs = [contactName, contactEmail, contactPhone];
  const quickButtons = [...root.querySelectorAll(".white5-ai-quick button")];

  let history = loadHistory();
  let selectedImages = [];
  let busy = false;
  let processingPhotos = false;

  function loadHistory() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .slice(-MAX_HISTORY);
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {
      // Chat still works when browser storage is blocked.
    }
  }

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      setTimeout(() => input.focus(), 50);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function appendImageGallery(parent, images) {
    if (!Array.isArray(images) || !images.length) return;
    const gallery = document.createElement("div");
    gallery.className = "white5-ai-message-images";
    images.forEach((image, index) => {
      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = image.name || `Attached photo ${index + 1}`;
      img.loading = "lazy";
      gallery.appendChild(img);
    });
    parent.appendChild(gallery);
  }

  function createMessage(role, text = "", options = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = `white5-ai-message is-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "white5-ai-bubble" + (options.error ? " is-error" : "");
    if (options.typing) {
      bubble.innerHTML = '<span class="white5-ai-typing" aria-label="White5 AI is typing"><span></span><span></span><span></span></span>';
    } else {
      if (text) {
        const textElement = document.createElement("div");
        textElement.textContent = text;
        bubble.appendChild(textElement);
      }
      appendImageGallery(bubble, options.images || []);
    }
    wrapper.appendChild(bubble);
    messagesElement.appendChild(wrapper);
    scrollToBottom();
    return bubble;
  }

  function renderInitialMessages() {
    if (history.length) {
      history.forEach((message) => createMessage(message.role, message.content));
      return;
    }

    createMessage(
      "assistant",
      "Hi — I can help you narrow down a White5 quote in about a minute. Describe the job or attach up to four photos.",
    );
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendButton.disabled = value;
    attachButton.disabled = value || processingPhotos;
    contactInputs.forEach((contactInput) => { contactInput.disabled = value; });
    quickButtons.forEach((button) => { button.disabled = value; });
    attachmentsElement.querySelectorAll("button").forEach((button) => { button.disabled = value; });
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }

  function setAttachmentStatus(message = "", isError = false) {
    attachmentStatus.textContent = message;
    attachmentStatus.classList.toggle("is-error", Boolean(isError));
  }

  function renderAttachments() {
    attachmentsElement.replaceChildren();
    attachmentsElement.hidden = selectedImages.length === 0;

    selectedImages.forEach((image, index) => {
      const item = document.createElement("div");
      item.className = "white5-ai-attachment";

      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = image.name || `Selected photo ${index + 1}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${image.name || `photo ${index + 1}`}`);
      remove.textContent = "×";
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        selectedImages.splice(index, 1);
        renderAttachments();
        setAttachmentStatus(selectedImages.length ? `${selectedImages.length} of ${MAX_IMAGES} photos selected.` : "");
      });

      item.append(img, remove);
      attachmentsElement.appendChild(item);
    });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("This photo could not be opened."));
      image.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("This photo could not be compressed.")),
        "image/jpeg",
        quality,
      );
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("This photo could not be prepared."));
      reader.readAsDataURL(blob);
    });
  }

  async function compressImage(file) {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error("Only JPG, PNG, and WebP photos are supported.");
    }
    if (file.size > MAX_ORIGINAL_FILE_BYTES) {
      throw new Error(`${file.name || "One photo"} is larger than 12 MB.`);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      let dimensionLimit = MAX_DIMENSION;
      let finalBlob = null;
      let finalWidth = 0;
      let finalHeight = 0;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const scale = Math.min(1, dimensionLimit / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Your browser could not prepare this photo.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        for (const quality of [0.82, 0.72, 0.62, 0.54]) {
          const blob = await canvasToBlob(canvas, quality);
          finalBlob = blob;
          finalWidth = width;
          finalHeight = height;
          if (blob.size <= MAX_COMPRESSED_BYTES) break;
        }

        if (finalBlob && finalBlob.size <= MAX_COMPRESSED_BYTES) break;
        dimensionLimit = Math.round(dimensionLimit * 0.78);
      }

      if (!finalBlob || finalBlob.size > 1100 * 1024) {
        throw new Error(`${file.name || "One photo"} could not be reduced enough. Try a smaller image.`);
      }

      return {
        name: String(file.name || "photo.jpg").slice(0, 120),
        dataUrl: await blobToDataUrl(finalBlob),
        size: finalBlob.size,
        width: finalWidth,
        height: finalHeight,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;

    const spacesLeft = MAX_IMAGES - selectedImages.length;
    if (spacesLeft <= 0) {
      setAttachmentStatus(`You can attach up to ${MAX_IMAGES} photos.`, true);
      return;
    }

    processingPhotos = true;
    attachButton.disabled = true;
    setAttachmentStatus("Preparing photos…");

    try {
      const accepted = files.slice(0, spacesLeft);
      for (const file of accepted) {
        const compressed = await compressImage(file);
        selectedImages.push(compressed);
        renderAttachments();
      }

      if (files.length > spacesLeft) {
        setAttachmentStatus(`Added ${accepted.length} photo(s). Maximum is ${MAX_IMAGES}.`, true);
      } else {
        setAttachmentStatus(`${selectedImages.length} of ${MAX_IMAGES} photos selected.`);
      }
    } catch (error) {
      setAttachmentStatus(error instanceof Error ? error.message : "A photo could not be prepared.", true);
    } finally {
      processingPhotos = false;
      attachButton.disabled = busy;
      fileInput.value = "";
    }
  }

  function clearAttachments() {
    selectedImages = [];
    renderAttachments();
    setAttachmentStatus("");
  }

  function extractCompletedText(response) {
    const output = Array.isArray(response?.output) ? response.output : [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      }
    }
    return "";
  }

  async function streamReply(messages, bubble, images) {
    const apiMessages = messages.map((message) => ({ ...message }));
    if (images.length && apiMessages.length) {
      const latest = apiMessages[apiMessages.length - 1];
      latest.content = `${latest.content}\n\n[Customer attached ${images.length} photo(s) to this message.]`;
    }

    const response = await fetch("/api/ai-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        messages: apiMessages,
        images: images.map((image) => ({
          name: image.name,
          dataUrl: image.dataUrl,
        })),
        contact: {
          name: contactName.value.trim(),
          email: contactEmail.value.trim(),
          phone: contactPhone.value.trim(),
        },
        page: {
          path: `${location.pathname}${location.hash}`,
          title: document.title,
        },
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "White5 AI is temporarily unavailable.");
    }

    if (!response.body) throw new Error("White5 AI is temporarily unavailable.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let started = false;

    function handleBlock(block) {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const eventName = eventLine ? eventLine.slice(6).trim() : "";
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!dataLines.length) return;
      const dataText = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
      if (!dataText || dataText === "[DONE]") return;

      let payload;
      try {
        payload = JSON.parse(dataText);
      } catch {
        return;
      }

      if (eventName === "response.output_text.delta" && typeof payload.delta === "string") {
        if (!started) {
          bubble.textContent = "";
          started = true;
        }
        reply += payload.delta;
        bubble.textContent = reply;
        scrollToBottom();
        return;
      }

      if (eventName === "response.completed" && !reply) {
        reply = extractCompletedText(payload.response);
        if (reply) bubble.textContent = reply;
      }

      if (eventName === "error" || eventName === "response.failed") {
        throw new Error("White5 AI could not complete that response.");
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleBlock(block);
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) handleBlock(buffer.trim());

    return reply.trim();
  }

  async function sendMessage(text) {
    const message = String(text || "").trim().slice(0, 1400);
    const photos = selectedImages.slice();
    if ((!message && !photos.length) || busy || processingPhotos) return;

    setOpen(true);
    const displayText = message || (photos.length === 1 ? "Photo attached" : `${photos.length} photos attached`);
    createMessage("user", displayText, { images: photos });

    const historyText = message || `I attached ${photos.length} photo${photos.length === 1 ? "" : "s"} for review.`;
    history.push({ role: "user", content: historyText });
    history = history.slice(-MAX_HISTORY);
    saveHistory();

    input.value = "";
    resizeInput();
    clearAttachments();
    setBusy(true);
    const assistantBubble = createMessage("assistant", "", { typing: true });

    try {
      const reply = await streamReply(history, assistantBubble, photos);
      const finalReply = reply || "Tell me what you need cleaned and I’ll help with the next step.";
      assistantBubble.textContent = finalReply;
      history.push({ role: "assistant", content: finalReply });
      history = history.slice(-MAX_HISTORY);
      saveHistory();
    } catch (error) {
      assistantBubble.classList.add("is-error");
      assistantBubble.textContent = error instanceof Error
        ? error.message
        : "White5 AI is temporarily unavailable. Please try again shortly.";
    } finally {
      setBusy(false);
      input.focus();
      scrollToBottom();
    }
  }

  launcher.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));
  closeButton.addEventListener("click", () => setOpen(false));
  attachButton.addEventListener("click", () => {
    if (!busy && !processingPhotos) fileInput.click();
  });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  quickButtons.forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.message));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });

  renderInitialMessages();
})();
