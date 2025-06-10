/* 1) Supabase 初期化 */
const { createClient } = window.supabase;
const db = createClient(
  'https://hccairtzksnnqdujalgv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjY2FpcnR6a3NubnFkdWphbGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkyNjI2MTYsImV4cCI6MjA2NDgzODYxNn0.TVDucIs5ClTWuykg_fy4yv65Rg-xbSIPFIfvIYawy_k'
);

/* 2) グローバル変数 */
let globalUID = null;
let html5QrCode = null;
let articlesCache = [];
let intersectionObserver;
const ARTICLES_PER_PAGE = 10;
let currentPage = 0;
let currentCategory = 'all';
let isLoadingMore = false;
let isInitialAuthCheckDone = false;
const appData = { qrString: "ROUTE227_STAMP_2025" };

/* 3) メイン処理 */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initializeIntersectionObserver();

  db.auth.onAuthStateChange(async (event, session) => {
    globalUID = session?.user?.id || null;
    updateUserStatusUI(session);

    if (!isInitialAuthCheckDone) {
      isInitialAuthCheckDone = true;
      const appLoader = document.getElementById('app-loader');
      appLoader.classList.add('hidden');
      
      const lastSection = sessionStorage.getItem('activeSection') || 'feed-section';
      await showSection(lastSection, true);
    } else {
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem('activeSection');
        window.location.reload();
      }
    }
  });
});

/* 4) UIインタラクションと表示切替 */
function setupEventListeners() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const sectionId = e.currentTarget.dataset.section;
      if (document.querySelector(`.section.active`)?.id === sectionId) return;
      sessionStorage.setItem('activeSection', sectionId);
      showSection(sectionId);
    });
  });

  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    if (isLoadingMore) return;
    currentPage++;
    renderArticles(currentCategory, false);
  });

  const emailForm = document.getElementById('email-form');
  emailForm?.addEventListener('submit', handleEmailLogin);

  const otpForm = document.getElementById('otp-form');
  otpForm?.addEventListener('submit', handleOtpVerify);
  
  document.getElementById('change-email-btn')?.addEventListener('click', () => {
    document.getElementById('otp-form').classList.add('hidden');
    document.getElementById('email-form').classList.remove('hidden');
    document.getElementById('email-message').textContent = '';
    document.getElementById('otp-message').textContent = '';
  });

  document.body.addEventListener('click', (e) => {
    if (e.target.matches('.close-modal') || e.target.matches('.modal-backdrop') || e.target.matches('.close-notification')) {
      const backdrop = e.target.closest('.modal-backdrop');
      if (backdrop) closeModal(backdrop.id.replace('-backdrop', ''));
    }
  });
}

async function showSection(sectionId, isInitialLoad = false) {
  const transitionOverlay = document.getElementById('transition-overlay');
  
  const transitionAction = async () => {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === sectionId));
    
    const sectionElement = document.getElementById(sectionId);
    if (sectionElement) {
      sectionElement.classList.add('active');
      if (sectionId === 'feed-section') await initializeFeedPage();
      else if (sectionId === 'foodtruck-section') await initializeFoodtruckPage();
    }
  };

  if (isInitialLoad) {
    await transitionAction();
  } else {
    transitionOverlay.classList.add('animate');
    await new Promise(resolve => setTimeout(resolve, 400));
    await transitionAction();
    await new Promise(resolve => setTimeout(resolve, 100));
    transitionOverlay.classList.remove('animate');
  }
}

function updateUserStatusUI(session) {
    const userStatusDiv = document.getElementById('user-status');
    if (userStatusDiv) {
        userStatusDiv.innerHTML = session ? '<button id="logout-button" class="btn btn-secondary">ログアウト</button>' : '<button id="login-button" class="btn btn-primary">ログイン</button>';
        if (session) {
            document.getElementById('logout-button').addEventListener('click', () => db.auth.signOut());
        } else {
            document.getElementById('login-button').addEventListener('click', () => openModal('login-modal'));
        }
    }
}

function openModal(modalId) {
    document.getElementById(`${modalId}-backdrop`)?.classList.add('active');
}
function closeModal(modalId) {
    const backdrop = document.getElementById(`${modalId}-backdrop`);
    backdrop?.classList.remove('active');
    if (modalId === 'qr-modal' && html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(console.error);
    }
}

/* 5) ページ別初期化ロジック */
async function initializeFeedPage() {
  const categoryTabs = document.getElementById('category-tabs');
  if (categoryTabs && !categoryTabs.dataset.listenerAttached) {
    categoryTabs.dataset.listenerAttached = 'true';
    categoryTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('category-tab')) {
        currentPage = 0;
        currentCategory = e.target.dataset.category;
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        renderArticles(currentCategory, true);
      }
    });
  }
  await renderArticles('all', true);
}

async function initializeFoodtruckPage() {
  if (!globalUID) {
    updateStampDisplay(0);
    updateRewardButtons(0);
    return;
  }
  
  document.getElementById('scan-qr')?.addEventListener('click', initQRScanner);
  document.getElementById('coffee-reward')?.addEventListener('click', () => redeemReward('coffee'));
  document.getElementById('curry-reward')?.addEventListener('click', () => redeemReward('curry'));
  
  try {
    const stampCount = await fetchStampCount(globalUID);
    updateStampDisplay(stampCount);
    updateRewardButtons(stampCount);
  } catch (error) {
    console.error("Failed to fetch stamp count:", error);
  }
}

/* 6) ヘルパー関数群 (UI/UX) */
function initializeIntersectionObserver() {
    intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animationDelay = `${(entry.target.dataset.index % 5) * 0.1}s`;
                entry.target.classList.add('in-view');
                intersectionObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
}

function showNotification(title, msg) {
  document.getElementById('notification-title').textContent = title;
  document.getElementById('notification-message').textContent = msg;
  openModal('notification-modal');
}

function updateStampDisplay(count) {
  document.querySelectorAll('.stamp').forEach((el, i) => {
    el.classList.toggle('stamped', i < count);
  });
}

function updateRewardButtons(count) {
  const coffeeBtn = document.getElementById('coffee-reward');
  const curryBtn = document.getElementById('curry-reward');
  if (coffeeBtn) coffeeBtn.disabled = count < 3;
  if (curryBtn) curryBtn.disabled = count < 6;
  document.getElementById('coffee-reward-item')?.classList.toggle('available', count >= 3);
  document.getElementById('curry-reward-item')?.classList.toggle('available', count >= 6);
}

/* 7) 認証とデータ処理 */
async function handleEmailLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('email');
  const emailMessage = document.getElementById('email-message');
  const submitButton = e.target.querySelector('button[type="submit"]');
  submitButton.disabled = true; submitButton.textContent = '送信中...'; emailMessage.textContent = '';
  try {
    const { error } = await db.auth.signInWithOtp({ email: emailInput.value.trim(), options: { shouldCreateUser: true }});
    if (error) throw error;
    document.getElementById('otp-email-display').textContent = emailInput.value.trim();
    document.getElementById('email-form').classList.add('hidden');
    document.getElementById('otp-form').classList.remove('hidden');
  } catch (err) {
    emailMessage.textContent = `エラー: ${err.message}`;
  } finally {
    submitButton.disabled = false; submitButton.textContent = '認証コードを送信';
  }
}

async function handleOtpVerify(e) {
    e.preventDefault();
    const otpMessage = document.getElementById('otp-message');
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true; submitButton.textContent = '認証中...'; otpMessage.textContent = '';
    try {
        const email = document.getElementById('otp-email-display').textContent;
        const token = document.getElementById('otp-code').value.trim();
        const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
        if (error) throw error;
        closeModal('login-modal');
        await showSection(sessionStorage.getItem('activeSection') || 'foodtruck-section');
    } catch (err) {
        otpMessage.textContent = `エラー: ${err.message}`;
    } finally {
        submitButton.disabled = false; submitButton.textContent = '認証する';
    }
}

async function fetchStampCount(uid) {
  const { data, error } = await db.from('users').select('stamp_count').eq('supabase_uid', uid).maybeSingle();
  if (error) throw error;
  return data?.stamp_count || 0;
}

async function updateStampCount(uid, newCount) {
  const { data, error } = await db.from('users').update({ stamp_count: newCount, updated_at: new Date().toISOString() }).eq('supabase_uid', uid).select().single();
  if (error) throw error;
  return data.stamp_count;
}

async function addStamp() {
  if (!globalUID) return openModal('login-modal');
  try {
    let count = await fetchStampCount(globalUID);
    if (count >= 6) return showNotification('コンプリート！', 'スタンプが全てたまりました！');
    count = await updateStampCount(globalUID, count + 1);
    updateStampDisplay(count);
    updateRewardButtons(count);
    showNotification('スタンプ獲得', `現在 ${count} 個`);
  } catch (error) {
    showNotification('エラー', 'スタンプの追加に失敗しました。');
  }
}

async function redeemReward(type) {
    if (!globalUID) return openModal('login-modal');
    try {
        let count = await fetchStampCount(globalUID);
        const required = type === 'coffee' ? 3 : 6;
        if (count < required) return;
        count = await updateStampCount(globalUID, count - required);
        updateStampDisplay(count);
        updateRewardButtons(count);
        showNotification('交換完了', `${type === 'coffee' ? 'コーヒー' : 'カレー'}と交換しました！`);
    } catch (error) {
        showNotification('エラー', '特典の交換に失敗しました。');
    }
}

/* 8) 記事とQRコード */
async function renderArticles(category, clearContainer) {
    const articlesContainer = document.getElementById('articles-container');
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (!articlesContainer || !loadMoreBtn) return;

    isLoadingMore = true;
    if (clearContainer) {
        articlesContainer.innerHTML = '<div class="loading-spinner" style="margin: 40px auto;"></div>';
        currentPage = 0;
        articlesCache = [];
    }
    loadMoreBtn.textContent = '読み込み中...';
    loadMoreBtn.disabled = true;

    try {
        const from = currentPage * ARTICLES_PER_PAGE;
        const { data, error } = await db.from('articles').select('*').order('created_at', { ascending: false }).eq(category === 'all' ? 'is_published' : 'category', category === 'all' ? true : category).range(from, from + ARTICLES_PER_PAGE - 1);
        if (error) throw error;

        if (clearContainer) articlesContainer.innerHTML = '';
        
        if (data.length === 0 && clearContainer) {
            articlesContainer.innerHTML = '<p style="text-align:center; padding: 40px;">記事はまだありません。</p>';
        } else {
            data.forEach((cardData, index) => {
                const div = document.createElement('div');
                div.className = 'card';
                div.dataset.index = index; // for animation delay
                const placeholderUrl = 'https://via.placeholder.com/400x250.png?text=Route227';
                div.innerHTML = `
                    <div class="article-link" data-article-id="${cardData.id}" role="button">
                        <img src="${cardData.image_url || placeholderUrl}" alt="${cardData.title}" loading="lazy" onerror="this.src='${placeholderUrl}';">
                        <div class="card-body">
                            <h3 class="article-title">${cardData.title}</h3>
                            <p class="article-excerpt">${cardData.summary}</p>
                        </div>
                    </div>`;
                articlesContainer.appendChild(div);
                intersectionObserver.observe(div); // Observe for fade-in
            });
            articlesCache.push(...data);
        }

        loadMoreBtn.classList.toggle('visible', data.length === ARTICLES_PER_PAGE);
    } catch (error) {
        articlesContainer.innerHTML = '<p style="text-align:center; padding: 40px; color: var(--color-accent-red);">記事の読み込みに失敗しました。</p>';
    } finally {
        isLoadingMore = false;
        loadMoreBtn.textContent = 'さらに読み込む';
        loadMoreBtn.disabled = false;
        document.querySelectorAll('.article-link').forEach(link => {
            link.addEventListener('click', (e) => showSummaryModal(parseInt(e.currentTarget.dataset.articleId, 10)));
        });
    }
}

function showSummaryModal(articleId) {
    const article = articlesCache.find(a => a.id === articleId);
    if (!article) return;
    document.getElementById('summary-image').style.backgroundImage = `url('${article.image_url || ''}')`;
    document.getElementById('summary-title').textContent = article.title;
    document.getElementById('summary-bullets').innerHTML = article.summary_points?.map(p => `<li>${p}</li>`).join('') || '';
    document.getElementById('summary-read-more').href = article.article_url;
    openModal('summary-modal');
}

function initQRScanner() {
  openModal('qr-modal');
  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } },
    async (decodedText) => {
      if (html5QrCode.isScanning) await html5QrCode.stop();
      closeModal('qr-modal');
      if (decodedText === appData.qrString) await addStamp();
      else showNotification('無効なQR', 'お店のQRコードではありません。');
    },
    (errorMessage) => {}
  ).catch(() => showNotification('エラー', 'カメラの起動に失敗しました'));
}
