(() => {
  const form = document.querySelector('[data-service-request]') || document.getElementById('window-quote-form');
  if (!form) return;
  const status = document.getElementById('quote-status');
  const submit = document.getElementById('quote-submit');
  const contact = document.getElementById('quote-contact');
  const photoInput = document.getElementById('quote-photos');
  const tokenInput = document.getElementById('quote-turnstile-token');
  let widgetId = null;
  let protectionPromise = null;
  let sending = false;

  function setStatus(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function readContact(value) {
    const text = value.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { email: text, phone: '' };
    const digits = text.replace(/\D/g, '');
    if (/^\+?[\d\s().-]+$/.test(text) && digits.length >= 10 && digits.length <= 15) {
      return { email: '', phone: text };
    }
    return null;
  }

  contact.addEventListener('input', () => contact.setCustomValidity(''));

  function refreshPhotos() {
    const count = photoInput.files.length;
    photoInput.setCustomValidity(count > 5 ? 'Please select no more than 5 photos.' : '');
    document.getElementById('photos-selected').hidden = !count;
    document.getElementById('photos-count').textContent = `${count} photo${count === 1 ? '' : 's'} selected`;
  }
  photoInput.addEventListener('change', refreshPhotos);
  document.getElementById('remove-photos').addEventListener('click', () => {
    photoInput.value = '';
    refreshPhotos();
  });

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const timeout = setTimeout(() => { script.remove(); reject(new Error('Spam protection did not load.')); }, 15000);
      script.onload = () => { clearTimeout(timeout); window.turnstile ? resolve() : reject(new Error('Spam protection did not load.')); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Spam protection did not load.')); };
      document.head.append(script);
    });
  }

  function ensureProtection() {
    if (widgetId !== null) return Promise.resolve();
    if (protectionPromise) return protectionPromise;
    protectionPromise = (async () => {
      const response = await fetch('/api/service-request-config', { cache: 'no-store' });
      const config = await response.json();
      if (!response.ok || !config.ok || !config.turnstileSiteKey) throw new Error('The form is temporarily unavailable. Please call 403-479-3905.');
      await loadTurnstileScript();
      widgetId = window.turnstile.render('#quote-turnstile', {
        sitekey: config.turnstileSiteKey,
        action: 'service-request',
        theme: 'dark',
        size: 'flexible',
        callback(token) { tokenInput.value = token; },
        'expired-callback'() { tokenInput.value = ''; },
        'error-callback'() { tokenInput.value = ''; setStatus('Please retry the spam protection check, or call 403-479-3905.', 'error'); },
      });
    })().catch(error => {
      protectionPromise = null;
      throw error;
    });
    return protectionPromise;
  }

  const startProtection = () => ensureProtection().catch(error => setStatus(error.message, 'error'));
  form.addEventListener('focusin', startProtection, { once: true });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      startProtection();
    }, { rootMargin: '250px' });
    observer.observe(form);
  } else {
    startProtection();
  }

  async function preparePhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please use JPG, PNG or WebP photos.');
    if (file.size > 20000000) throw new Error('Please choose photos smaller than 20 MB each.');
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('One photo could not be opened. Please choose another image.'));
        image.src = objectUrl;
      });
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Photos could not be prepared. Try sending without photos.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.8, .65, .5]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= 600000) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
        }
      }
      throw new Error('One photo is still too large. Please choose a smaller image.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function trackAcceptedRequest() {
    // A CTA click, validation error or rejected request is not a lead.
    try {
      if (typeof window.gtag === 'function') window.gtag('event', 'conversion', { send_to: 'AW-18208326566/BLZ_CNyjlcUcEKaHtOpD' });
      if (typeof window.white5_report_meta_lead === 'function') window.white5_report_meta_lead();
      if (typeof window.white5_report_openai_lead === 'function') window.white5_report_openai_lead();
    } catch { /* Tracking must never turn a delivered request into a form error. */ }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    setStatus('');
    const contactFields = readContact(contact.value);
    contact.setCustomValidity(contactFields ? '' : 'Please enter a valid email address or phone number with area code.');
    if (!form.reportValidity()) return;
    sending = true;
    submit.disabled = true;
    submit.textContent = 'Preparing…';
    let requestStarted = false;
    try {
      await ensureProtection();
      if (!tokenInput.value) throw new Error('Please complete the spam protection check, then send your request.');
      const data = new FormData(form);
      data.delete('contact');
      data.delete('photos');
      data.set('email', contactFields.email);
      data.set('phone', contactFields.phone);
      for (const file of photoInput.files) data.append('photos', await preparePhoto(file));
      if (!tokenInput.value) throw new Error('The spam protection check expired. Please complete it again.');
      data.set('turnstileToken', tokenInput.value);
      submit.textContent = 'Sending…';
      requestStarted = true;
      const response = await fetch(form.action, { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'We could not send your request. Please call 403-479-3905.');
      const serviceName = form.dataset.serviceName || 'window cleaning';
      setStatus(`Thank you! Your request has been sent. We’ll contact you about your ${serviceName} estimate.`, 'success');
      trackAcceptedRequest();
      form.reset();
      refreshPhotos();
    } catch (error) {
      setStatus(error instanceof Error && error.message ? error.message : 'We could not send your request. Please call 403-479-3905.', 'error');
    } finally {
      if (requestStarted) {
        tokenInput.value = '';
        if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
      }
      sending = false;
      submit.disabled = false;
      submit.textContent = 'Request My Estimate';
    }
  });
})();
