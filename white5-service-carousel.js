/* Swipe photos without adding visible controls or changing the card design. */
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
    const track = document.createElement('div');
    track.className = 'service-carousel__track';
    track.tabIndex = 0;
    track.setAttribute('aria-label', cover.alt + '. Swipe or use arrow keys to browse photos.');
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
    track.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const current = Math.round(track.scrollLeft / (track.clientWidth || 1));
      const index = Math.max(0, Math.min(track.children.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
      track.scrollTo({left: index * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
    gallery.append(track);
  });
})();
