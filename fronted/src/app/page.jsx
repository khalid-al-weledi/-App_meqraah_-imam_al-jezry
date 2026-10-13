const programs = [
  {
    icon: "۞",
    title: "التلقين وتصحيح الأداء",
    text: "تحسين التلاوة وتصحيح المخارج والصفات وضبط الأداء القرآني."
  },
  {
    icon: "✦",
    title: "حفظ القرآن الكريم",
    text: "خطة للحفظ الجديد والربط والمراجعة والاختبارات الدورية."
  },
  {
    icon: "◈",
    title: "الإعداد لإجازة حفص",
    text: "تهيئة الطالب للإتقان والاستعداد للإجازة برواية حفص عن عاصم."
  },
  {
    icon: "۞",
    title: "القراءات السبع",
    text: "دراسة القراءات السبع وأصولها وفرشها وفق خطة علمية."
  }
];

const features = [
  {
    icon: "◷",
    title: "جلسات منظمة",
    text: "تنظيم المواعيد ومتابعة الحضور والغياب وسجل القراءة."
  },
  {
    icon: "◇",
    title: "رصيد واضح",
    text: "عرض رصيد الدقائق وحركاته وسجل طلبات الدفع بشفافية."
  },
  {
    icon: "◎",
    title: "متابعة علمية",
    text: "متابعة مستوى الطالب والامتحانات والتقدم في البرنامج."
  }
];

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="container nav">
          <a className="brand" href="/">
            <span className="brand-mark">ج</span>
            <span>
              مقرأة الإمام الجزري
              <small>للإقراء والإجازة بالسند</small>
            </span>
          </a>

          <nav className="nav-links">
            <a href="#programs">البرامج</a>
            <a href="#features">مميزات المقرأة</a>
            <a href="#steps">طريقة الالتحاق</a>
          </nav>

          <div className="actions">
            <a className="btn btn-outline" href="/login">دخول</a>
            <a className="btn btn-primary" href="/register">سجّل الآن</a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container hero-inner">
            <div>
              <span className="eyebrow">
                رحلة علمية في رحاب القرآن الكريم
              </span>

              <h1>
                إتقان التلاوة،
                <br />
                وعناية بالقراءات،
                <br />
                وطريق إلى الإجازة بالسند
              </h1>

              <p>
                مقرأة الإمام الجزري للإقراء والإجازة بالسند؛ منصة لتنظيم
                رحلة الطالب القرآنية، من تصحيح التلاوة إلى الحفظ والإعداد
                للإجازة، بإشراف علمي ومتابعة مستمرة.
              </p>

              <div className="hero-buttons">
                <a className="btn btn-gold" href="/register">
                  ابدأ التسجيل ←
                </a>
                <a className="btn btn-outline" href="#programs">
                  اكتشف البرامج
                </a>
              </div>
            </div>

            <div className="hero-art" aria-hidden="true">
              <div className="arch">
                <div className="arch-inner">
                  <div className="arch-symbol">۞</div>
                  <div className="arch-caption">
                    وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا
                  </div>
                  <p className="arch-description">
                    قراءة · إتقان · إجازة · سند
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="programs">
          <div className="container">
            <div className="section-head">
              <span className="kicker">برامج المقرأة</span>
              <h2>اختر مسارك القرآني</h2>
              <p>
                برامج واضحة المراحل، تراعي مستوى الطالب وهدفه العلمي.
              </p>
            </div>

            <div className="grid">
              {programs.map((program) => (
                <article className="card" key={program.title}>
                  <div className="card-icon">{program.icon}</div>
                  <h3>{program.title}</h3>
                  <p>{program.text}</p>
                  <a className="text-link" href="/register">
                    الالتحاق بالبرنامج ←
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-muted" id="features">
          <div className="container">
            <div className="section-head">
              <span className="kicker">منظومة مترابطة</span>
              <h2>متابعة علمية وإدارية في مكان واحد</h2>
              <p>
                تجمع المنصة بين الدراسة وتنظيم الجلسات ومتابعة الرصيد والنتائج.
              </p>
            </div>

            <div className="grid">
              {features.map((feature) => (
                <article className="card" key={feature.title}>
                  <div className="card-icon">{feature.icon}</div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="steps">
          <div className="container">
            <div className="section-head">
              <span className="kicker">خطوات الالتحاق</span>
              <h2>ابدأ رحلتك بثلاث خطوات</h2>
            </div>

            <div className="steps">
              <article className="card">
                <span className="step-number">الخطوة الأولى</span>
                <h3>أنشئ حسابك</h3>
                <p>أدخل بياناتك وحدد البرنامج ومستواك السابق.</p>
              </article>

              <article className="card">
                <span className="step-number">الخطوة الثانية</span>
                <h3>انتظر مراجعة الطلب</h3>
                <p>تراجع الإدارة البيانات وتتابع معك الخطوات اللازمة.</p>
              </article>

              <article className="card">
                <span className="step-number">الخطوة الثالثة</span>
                <h3>ابدأ الدراسة</h3>
                <p>تابع مواعيدك وجلساتك وتقدمك من حسابك.</p>
              </article>
            </div>

            <div className="callout">
              <div>
                <h2>هل أنت مستعد للبدء؟</h2>
                <p>قدّم طلب الالتحاق بمقرأة الإمام الجزري.</p>
              </div>
              <a className="btn btn-primary" href="/register">
                الانتقال إلى التسجيل
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="brand footer-brand">
            <span className="brand-mark">ج</span>
            <span>
              مقرأة الإمام الجزري
              <small>للإقراء والإجازة بالسند</small>
            </span>
          </div>

          <small>
            © مقرأة الإمام الجزري — منصة تعليم القرآن الكريم والقراءات.
          </small>
        </div>
      </footer>
    </>
  );
}