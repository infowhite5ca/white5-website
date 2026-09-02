(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function setupNavigation() {
    const toggle = $(".nav-toggle");
    const nav = $("#site-menu");
    const dropdown = $(".nav-dropdown");
    const dropdownButton = $(".nav-dropdown__button");
    if (!toggle || !nav) return;

    const closeDropdown = () => {
      if (!dropdown || !dropdownButton) return;
      dropdown.classList.remove("is-open");
      dropdownButton.setAttribute("aria-expanded", "false");
    };

    const closeNav = () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("nav-open");
      closeDropdown();
    };

    toggle.addEventListener("click", () => {
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(opening));
      nav.classList.toggle("is-open", opening);
      document.body.classList.toggle("nav-open", opening);
    });

    if (dropdown && dropdownButton) {
      dropdownButton.addEventListener("click", (event) => {
        event.preventDefault();
        const opening = !dropdown.classList.contains("is-open");
        dropdown.classList.toggle("is-open", opening);
        dropdownButton.setAttribute("aria-expanded", String(opening));
      });
    }

    $$("a", nav).forEach((link) => link.addEventListener("click", closeNav));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeNav();
    });
    document.addEventListener("click", (event) => {
      if (window.innerWidth > 860 && dropdown && !dropdown.contains(event.target)) closeDropdown();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) closeNav();
    }, { passive: true });
  }

  let configPromise;
  function getTurnstileConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/deck-fence-config", { headers: { accept: "application/json" } })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.turnstileSiteKey) throw new Error("Spam protection is unavailable.");
          return data.turnstileSiteKey;
        });
    }
    return configPromise;
  }

  function waitForTurnstile() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        if (window.turnstile) return resolve(window.turnstile);
        attempts += 1;
        if (attempts >= 100) return reject(new Error("Spam protection did not load."));
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  async function setupQuoteForm(form) {
    const slot = $(".turnstile-slot", form);
    const tokenInput = $('input[name="turnstileToken"]', form);
    const status = $(".form-status", form);
    const submit = $('button[type="submit"]', form);
    let widgetId = null;

    const setStatus = (message, type = "") => {
      status.textContent = message;
      status.className = "form-status" + (type ? " is-" + type : "");
    };

    try {
      const [sitekey, turnstile] = await Promise.all([getTurnstileConfig(), waitForTurnstile()]);
      widgetId = turnstile.render(slot, {
        sitekey,
        callback(token) {
          tokenInput.value = token;
          setStatus("");
        },
        "expired-callback"() {
          tokenInput.value = "";
        },
        "error-callback"() {
          tokenInput.value = "";
          setStatus("Spam protection failed to load. Please refresh and try again.", "error");
        }
      });
    } catch (error) {
      setStatus((error && error.message) || "Spam protection is unavailable. Please call 403-479-3905.", "error");
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const address = String(data.get("address") || "").trim();
      const email = String(data.get("email") || "").trim();
      const phone = String(data.get("phone") || "").trim();
      const notes = String(data.get("notes") || "").trim();
      const service = String(form.dataset.service || "Exterior Cleaning").trim();
      const consent = data.get("consent") === "yes";
      const turnstileToken = String(data.get("turnstileToken") || "");

      if (!name || !address || (!email && !phone)) {
        setStatus("Please enter your name, property address, and an email or phone number.", "error");
        return;
      }
      if (!consent) {
        setStatus("Please agree that White5 may contact you about this request.", "error");
        return;
      }
      if (!turnstileToken) {
        setStatus("Please complete the spam protection check.", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Sending…";
      setStatus("Sending your request…");

      try {
        const response = await fetch("/api/service-request", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            name,
            address,
            email,
            phone,
            notes,
            services: [service],
            estimate: 0,
            details: service + " quote request from " + window.location.href,
            consent,
            turnstileToken,
            website: String(data.get("website") || "")
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok !== true) throw new Error(result.error || "We could not send your request.");
        form.reset();
        tokenInput.value = "";
        if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
        setStatus("Thank you! Your request was sent. White5 will contact you soon.", "success");
        if (typeof window.gtag === "function") {
          window.gtag("event", "generate_lead", { event_category: "service_quote", service });
        }
      } catch (error) {
        setStatus((error && error.message) || "We could not send your request. Please call 403-479-3905.", "error");
        tokenInput.value = "";
        if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
      } finally {
        submit.disabled = false;
        submit.textContent = "Request My Free Estimate";
      }
    });
  }

  function trackCalls() {
    $$('a[href^="tel:"]').forEach((link) => {
      link.addEventListener("click", () => {
        if (typeof window.gtag === "function") window.gtag("event", "phone_click", { event_category: "engagement" });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    $$(".service-quote-form").forEach(setupQuoteForm);
    trackCalls();
  });
})();