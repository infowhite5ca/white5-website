(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const toggle = header.querySelector('.site-header__toggle');
  const navigation = header.querySelector('.site-navigation');
  const services = header.querySelector('details');
  if (!toggle || !navigation) return;
  header.classList.add('site-header--enhanced');
  const close = () => {
    navigation.removeAttribute('data-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (services) services.open = false;
  };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    navigation.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (services?.open) {
      services.open = false;
      services.querySelector('summary').focus();
    } else {
      close();
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (services && !services.contains(event.target)) services.open = false;
    if (!header.contains(event.target)) close();
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  });
})();
