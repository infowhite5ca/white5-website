/* Independent service galleries; native touch scrolling, no autoplay. */
(() => {
  const galleries = [
    ['images/window-cleaning-3.jpg', 'images/window-cleaning-11.jpg'],
    ['images/gutters-cleaning-3.jpg', 'images/gutters-cleaning-6.jpg'],
    ['images/power-washing-1.jpg', 'images/IMG-20260707-WA0003.jpg']
  ];
  document.querySelectorAll('.service-card .service-cover').forEach((cover, cardIndex) => {
    const extras = galleries[cardIndex];
    if (!extras) return;
    const gallery = document.createElement('div');
    gallery.className = 'service-carousel';
    gallery.setAttribute('role', 'region');
    gallery.setAttribute('aria-roledescription', 'carousel');
    gallery.setAttribute('aria-label', cover.alt + ' photos');
    const track = document.createElement('div');
    track.className = 'service-carousel__track';
    track.tabIndex = 0;
    track.setAttribute('aria-label', 'Photo gallery. Swipe or use arrow keys to browse.');
    cover.replaceWith(gallery);
    track.append(cover);
    extras.forEach((src, i) => {
      const photo = document.createElement('img');
      photo.src = src;
      photo.alt = cover.alt + ' — project photo ' + (i + 2);
      photo.loading = 'lazy';
      photo.decoding = 'async';
      track.append(photo);
    });
    const count = document.createElement('span');
    count.className = 'service-carousel__count';
    const dots = document.createElement('div');
    dots.className = 'service-carousel__dots';
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Choose photo');
    let active = 0;
    const total = track.children.length;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const go = index => track.scrollTo({ left: Math.max(0, Math.min(total - 1, index)) * track.clientWidth, behavior: reduced.matches ? 'instant' : 'smooth' });
    const previous = document.createElement('button');
    const next = document.createElement('button');
    [previous, next].forEach((button, i) => {
      button.type = 'button';
      button.className = 'service-carousel__arrow ' + (i ? 'service-carousel__next' : 'service-carousel__previous');
      button.setAttribute('aria-label', i ? 'Next photo' : 'Previous photo');
      button.textContent = i ? '›' : '‹';
      button.addEventListener('click', () => go(active + (i ? 1 : -1)));
    });
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Show photo ' + (i + 1) + ' of ' + total);
      dot.addEventListener('click', () => go(i));
      dots.append(dot);
    }
    const update = () => {
      active = Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
      count.textContent = (active + 1) + ' / ' + total;
      previous.disabled = active === 0;
      next.disabled = active === total - 1;
      [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
    };
    track.addEventListener('scroll', update, { passive: true });
    track.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      go(active + (event.key === 'ArrowRight' ? 1 : -1));
    });
    gallery.append(track, previous, next, count, dots);
    update();
  });
})();
