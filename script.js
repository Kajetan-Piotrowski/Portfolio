// Menu mobilne
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');

menuToggle?.addEventListener('click', () => {
  const isOpen = nav?.classList.toggle('open') ?? false;
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});

document.querySelectorAll('.nav a').forEach(link => {
  link.addEventListener('click', () => {
    nav?.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
});

// Animacje elementów pojawiających się podczas przewijania
const revealElements = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealElements.forEach(element => observer.observe(element));
} else {
  revealElements.forEach(element => element.classList.add('show'));
}

// Wspólny podgląd ulotek i galerii zdjęć z pobieraniem pojedynczego obrazu
(() => {
  const groups = [
    {
      key: 'flyers',
      title: 'Ulotki',
      imageSelector: '.flyer-image',
      cardSelector: '.flyer-card',
      fallbackLabel: 'Ulotka'
    },
    {
      key: 'gallery',
      title: 'Galeria zdjęć',
      imageSelector: '.gallery-item img',
      cardSelector: '.gallery-item',
      fallbackLabel: 'Zdjęcie'
    }
  ].map(group => ({
    ...group,
    images: Array.from(document.querySelectorAll(group.imageSelector))
  })).filter(group => group.images.length > 0);

  if (!groups.length) return;

  const lightbox = document.createElement('div');
  lightbox.className = 'media-lightbox';
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-labelledby', 'media-lightbox-title');
  lightbox.innerHTML = `
    <div class="media-lightbox__top">
      <div class="media-lightbox__heading">
        <p class="media-lightbox__eyebrow" id="media-lightbox-title">Podgląd zdjęć</p>
        <span class="media-lightbox__caption"></span>
      </div>
      <div class="media-lightbox__actions">
        <span class="media-lightbox__counter" aria-live="polite"></span>
        <button class="media-lightbox__download" type="button" aria-label="Pobierz aktualne zdjęcie">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/></svg>
          <span>Pobierz</span>
        </button>
        <button class="media-lightbox__close" type="button" aria-label="Zamknij podgląd">×</button>
      </div>
    </div>
    <div class="media-lightbox__stage">
      <button class="media-lightbox__arrow media-lightbox__arrow--prev" type="button" aria-label="Poprzednie zdjęcie">‹</button>
      <img class="media-lightbox__image" alt="" draggable="false">
      <button class="media-lightbox__arrow media-lightbox__arrow--next" type="button" aria-label="Następne zdjęcie">›</button>
    </div>
    <div class="media-lightbox__bottom" aria-live="polite">Strzałki na klawiaturze lub przesunięcie palcem zmieniają zdjęcie</div>
  `;
  document.body.appendChild(lightbox);

  const title = lightbox.querySelector('.media-lightbox__eyebrow');
  const caption = lightbox.querySelector('.media-lightbox__caption');
  const counter = lightbox.querySelector('.media-lightbox__counter');
  const largeImage = lightbox.querySelector('.media-lightbox__image');
  const closeButton = lightbox.querySelector('.media-lightbox__close');
  const downloadButton = lightbox.querySelector('.media-lightbox__download');
  const previousButton = lightbox.querySelector('.media-lightbox__arrow--prev');
  const nextButton = lightbox.querySelector('.media-lightbox__arrow--next');
  const stage = lightbox.querySelector('.media-lightbox__stage');
  const status = lightbox.querySelector('.media-lightbox__bottom');

  let activeGroup = null;
  let currentIndex = 0;
  let activeTrigger = null;
  let closeTimer = null;
  let touchStart = null;

  const labelFor = (group, image, index) => {
    const card = image.closest(group.cardSelector);
    const figcaption = card?.querySelector('figcaption')?.textContent?.trim();
    if (group.key === 'gallery' && figcaption) return figcaption;
    if (image.dataset.caption?.trim()) return image.dataset.caption.trim();
    const alt = image.getAttribute('alt')?.trim();
    if (alt && !/^(ulotka wyborcza|zdjęcie|fotografia)/i.test(alt)) return alt;
    return `${group.fallbackLabel} ${index + 1}`;
  };

  const currentSource = () => {
    const image = activeGroup?.images[currentIndex];
    return image ? (image.currentSrc || image.src) : '';
  };

  const filenameFor = (group, image, index) => {
    try {
      const url = new URL(image.currentSrc || image.src, window.location.href);
      let filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'zdjecie');
      if (!/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(filename)) {
        filename = `${group.key === 'flyers' ? 'ulotka' : 'zdjecie'}-${index + 1}.png`;
      }
      return filename.replace(/[\\/:*?"<>|]/g, '-');
    } catch {
      return `${group.key === 'flyers' ? 'ulotka' : 'zdjecie'}-${index + 1}.png`;
    }
  };

  const showImage = index => {
    if (!activeGroup) return;
    currentIndex = (index + activeGroup.images.length) % activeGroup.images.length;
    const image = activeGroup.images[currentIndex];
    largeImage.src = image.currentSrc || image.src;
    largeImage.alt = labelFor(activeGroup, image, currentIndex);
    title.textContent = activeGroup.title;
    caption.textContent = labelFor(activeGroup, image, currentIndex);
    counter.textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(activeGroup.images.length).padStart(2, '0')}`;
    previousButton.hidden = activeGroup.images.length < 2;
    nextButton.hidden = activeGroup.images.length < 2;
    status.textContent = activeGroup.images.length > 1
      ? 'Strzałki na klawiaturze lub przesunięcie palcem zmieniają zdjęcie'
      : 'Pobierz zdjęcie lub zamknij podgląd';
  };

  const openLightbox = (group, index, trigger) => {
    window.clearTimeout(closeTimer);
    activeGroup = group;
    activeTrigger = trigger || document.activeElement;
    showImage(index);
    lightbox.hidden = false;
    document.body.classList.add('media-lightbox-open');
    requestAnimationFrame(() => {
      lightbox.classList.add('is-visible');
      closeButton.focus({ preventScroll: true });
    });
  };

  const closeLightbox = () => {
    if (lightbox.hidden) return;
    lightbox.classList.remove('is-visible');
    document.body.classList.remove('media-lightbox-open');
    closeTimer = window.setTimeout(() => {
      lightbox.hidden = true;
      activeGroup = null;
      if (activeTrigger && typeof activeTrigger.focus === 'function') {
        activeTrigger.focus({ preventScroll: true });
      }
    }, 220);
  };

  const downloadCurrentImage = async () => {
    if (!activeGroup) return;
    const image = activeGroup.images[currentIndex];
    const source = currentSource();
    if (!source) return;

    const filename = filenameFor(activeGroup, image, currentIndex);
    const originalText = downloadButton.querySelector('span').textContent;
    downloadButton.disabled = true;
    downloadButton.querySelector('span').textContent = 'Pobieranie…';
    status.textContent = `Przygotowywanie pliku: ${filename}`;

    const triggerDownload = (url, revoke = false) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    };

    try {
      // Na własnej domenie pobranie przez Blob zapewnia zapis zamiast otwarcia obrazu.
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      triggerDownload(URL.createObjectURL(blob), true);
      status.textContent = `Pobrano: ${filename}`;
    } catch (error) {
      // Awaryjne pobranie działa także wtedy, gdy serwer nie pozwala na fetch.
      triggerDownload(source);
      status.textContent = 'Rozpoczęto pobieranie zdjęcia';
    } finally {
      downloadButton.disabled = false;
      downloadButton.querySelector('span').textContent = originalText;
    }
  };

  groups.forEach(group => {
    group.images.forEach((image, index) => {
      const card = image.closest(group.cardSelector) || image;
      card.classList.add('media-openable');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Powiększ: ${labelFor(group, image, index)}`);
      card.addEventListener('click', event => {
        if (event.target.closest('a, button')) return;
        openLightbox(group, index, card);
      });
      card.addEventListener('keydown', event => {
        if (event.target !== card) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openLightbox(group, index, card);
        }
      });
      image.draggable = false;
    });
  });

  closeButton.addEventListener('click', closeLightbox);
  downloadButton.addEventListener('click', downloadCurrentImage);
  previousButton.addEventListener('click', () => showImage(currentIndex - 1));
  nextButton.addEventListener('click', () => showImage(currentIndex + 1));

  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', event => {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showImage(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(currentIndex + 1);
    }
  });

  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      touchStart = { x: event.clientX, y: event.clientY };
    }
  });
  stage.addEventListener('pointerup', event => {
    if (!touchStart || event.pointerType !== 'touch') return;
    const deltaX = event.clientX - touchStart.x;
    const deltaY = event.clientY - touchStart.y;
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      showImage(currentIndex + (deltaX < 0 ? 1 : -1));
    }
    touchStart = null;
  });
  stage.addEventListener('pointercancel', () => { touchStart = null; });
})();
