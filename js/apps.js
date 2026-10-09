/* =========================================================
   Layar — Web App Review Movie (TMDB + Alpine.js)
   Stateless: tidak memakai localStorage/sessionStorage.
   Setiap request ke TMDB membawa api_key sendiri.
   ========================================================= */

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_URL = 'https://image.tmdb.org/t/p';
const LANG = 'id-ID';
const DEFAULT_API_KEY = '70f1847b50a6890050b261e94c7f48c9';

function movieApp() {
  return {
    // ---------- State ----------
    apiKey: DEFAULT_API_KEY,
    apiKeyInput: DEFAULT_API_KEY,
    movies: [],
    featured: null,
    query: '',
    year: '',            // '' = semua tahun
    years: [],
    page: 1,
    totalPages: 1,
    loading: false,
    loadingMore: false,
    error: '',

    modalOpen: false,
    detailLoading: false,
    detail: null,
    detailError: '',
    trailerKey: null,
    showTrailer: false,

    _timer: null,
    _reqId: 0,

    // ---------- Lifecycle ----------
    init() {
      const now = new Date().getFullYear();
      for (let y = now; y >= 1980; y--) this.years.push(y);
      this.loadPopularMovies();
    },

    saveApiKey() {
      this.apiKey = this.apiKeyInput.trim();
      if (!this.apiKey) {
        this.error = 'API key TMDB tidak boleh kosong.';
        this.movies = [];
        this.featured = null;
        return;
      }
      this.loadMovies(true);
    },

    // ---------- Getter ----------
    get heading() {
      if (this.query && this.year) return `Hasil “${this.query}” di tahun ${this.year}`;
      if (this.query) return `Hasil untuk “${this.query}”`;
      if (this.year) return `Film populer tahun ${this.year}`;
      return 'Film populer';
    },

    // ---------- Helper ----------
    async api(path, params = {}) {
      if (!this.apiKey) {
        throw new Error('Masukkan API key TMDB pada kolom di bagian atas untuk memuat film.');
      }
      const url = new URL(BASE_URL + path);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('language', LANG);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, v);
      });

      const res = await fetch(url);
      if (res.status === 401) throw new Error('API key TMDB tidak valid. Periksa kembali key kamu.');
      if (!res.ok) throw new Error(`Permintaan gagal (kode ${res.status}).`);
      return res.json();
    },

    img(path, size = 'w500') {
      return path ? `${IMG_URL}/${size}${path}` : '';
    },
    yearOf(date) {
      return date ? date.slice(0, 4) : 'Tahun —';
    },
    rating(v) {
      return v ? Number(v).toFixed(1) : 'NR';
    },
    runtime(min) {
      if (!min) return '';
      const h = Math.floor(min / 60), m = min % 60;
      return h ? `${h}j ${m}m` : `${m}m`;
    },

    // ---------- Daftar film ----------
    // Memuat film populer (atau populer per tahun) — halaman pertama
    loadPopularMovies() {
      this.query = '';
      return this.loadMovies(true);
    },

    // Pencarian (digabung dengan filter tahun bila dipilih)
    searchMovies() {
      clearTimeout(this._timer);
      return this.loadMovies(true);
    },

    debounceSearch() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.searchMovies(), 450);
    },

    setYear(y) {
      this.year = y;
      this.loadMovies(true);
      document.getElementById('jelajah')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    resetAll() {
      this.query = '';
      this.year = '';
      this.loadMovies(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async loadMovies(reset = true) {
      const reqId = ++this._reqId;       // cegah hasil request lama menimpa yang baru
      const q = this.query.trim();
      const page = reset ? 1 : this.page + 1;

      if (reset) { this.loading = true; this.error = ''; }
      else this.loadingMore = true;

      try {
        let data;
        if (q) {
          data = await this.api('/search/movie', { query: q, page, year: this.year, include_adult: 'false' });
        } else if (this.year) {
          data = await this.api('/discover/movie', {
            page,
            sort_by: 'popularity.desc',
            primary_release_year: this.year,
            include_adult: 'false'
          });
        } else {
          data = await this.api('/movie/popular', { page });
        }
        if (reqId !== this._reqId) return;

        this.page = data.page;
        this.totalPages = Math.min(data.total_pages, 500);
        this.movies = reset ? data.results : [...this.movies, ...data.results];

        if (reset) {
          this.featured = q ? null : (data.results.find(m => m.backdrop_path) || null);
        }
      } catch (e) {
        if (reqId !== this._reqId) return;
        this.error = e.message || 'Terjadi kesalahan saat mengambil data.';
        if (reset) { this.movies = []; this.featured = null; }
      } finally {
        if (reqId === this._reqId) { this.loading = false; this.loadingMore = false; }
      }
    },

    loadMore() {
      if (this.loadingMore || this.page >= this.totalPages) return;
      return this.loadMovies(false);
    },

    // ---------- Detail film (modal) ----------
    async openDetail(id) {
      this.modalOpen = true;
      this.detailLoading = true;
      this.detail = null;
      this.detailError = '';
      this.trailerKey = null;
      this.showTrailer = false;

      try {
        const d = await this.api(`/movie/${id}`, {
          append_to_response: 'videos',
          include_video_language: 'id,en,null'
        });

        // Sinopsis bahasa Indonesia kadang kosong → ambil versi Inggris
        if (!d.overview) {
          try {
            const url = new URL(`${BASE_URL}/movie/${id}`);
            url.searchParams.set('api_key', this.apiKey);
            url.searchParams.set('language', 'en-US');
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Permintaan gagal (kode ${response.status}).`);
            const en = await response.json();
            d.overview = en.overview || '';
          } catch (_) { /* abaikan */ }
        }

        const vids = (d.videos && d.videos.results || []).filter(v => v.site === 'YouTube');
        const pick = vids.find(v => v.type === 'Trailer' && v.official)
                  || vids.find(v => v.type === 'Trailer')
                  || vids.find(v => v.type === 'Teaser');
        this.trailerKey = pick ? pick.key : null;
        this.detail = d;
      } catch (e) {
        this.detail = null;
        this.detailError = e.message || 'Terjadi kesalahan saat memuat detail film.';
      } finally {
        this.detailLoading = false;
      }
    },

    closeDetail() {
      if (!this.modalOpen) return;
      this.modalOpen = false;
      this.showTrailer = false;   // hentikan video
    }
  };
}