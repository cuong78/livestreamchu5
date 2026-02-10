import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import VideoPlayer from "@/components/VideoPlayer";
import ChatBox from "@/components/ChatBox";
import LoginModal from "@/components/LoginModal";
import BlockedIpsModal from "@/components/BlockedIpsModal";
import MatchScoreboard from "@/components/MatchScoreboard";
import MatchInfoPanel from "@/components/MatchInfoPanel";
import { streamApi, recordingApi } from "@/services/api";
import { websocketService } from "@/services/websocket";
import type { Stream, Comment, DailyRecording } from "@/types";
import "./ViewerPage.css";

const ViewerPage = () => {
  const [stream, setStream] = useState<Stream | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeServer, setActiveServer] = useState("HD1");
  const [showIntro, setShowIntro] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState<any>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showBlockedIpsModal, setShowBlockedIpsModal] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [realViewerCount, setRealViewerCount] = useState(0);
  const [recordings, setRecordings] = useState<DailyRecording[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<DailyRecording | null>(
    null
  );

  useEffect(() => {
    // Check if admin already logged in
    const token = localStorage.getItem("admin_token");
    const user = localStorage.getItem("admin_user");
    if (token && user) {
      setIsAdmin(true);
      setAdminUser(JSON.parse(user));
    }

    // Fetch current stream
    const fetchStream = async () => {
      try {
        const currentStream = await streamApi.getCurrentStream();
        setStream(currentStream);
        setLoading(false);
      } catch (err) {
        setError("Không thể tải stream. Vui lòng thử lại sau.");
        setLoading(false);
      }
    };

    fetchStream();

    // Connect WebSocket for real-time comments
    websocketService.connect(
      // onMessage: Nhận comment mới
      (comment) => {
        setComments((prev) => [...prev, comment]);
      },
      // onHistory: Nhận lịch sử comments khi mới kết nối
      (historyComments) => {
        console.log("Received comments history:", historyComments.length);
        setComments(historyComments);
      },
      // onViewerCount: Nhận số lượng người đang xem thật
      (count) => {
        setRealViewerCount(count);
      },
      // onCommentDeleted: Nhận event xóa comment
      (deletedComment) => {
        setComments((prev) =>
          prev.filter(
            (c) =>
              c.displayName !== deletedComment.displayName ||
              c.createdAt !== deletedComment.createdAt
          )
        );
      }
    );

    return () => {
      websocketService.disconnect();
    };
  }, []);

  // Cập nhật viewer count khi có thay đổi về stream status hoặc real viewer count
  useEffect(() => {
    if (stream?.status === "LIVE") {
      setViewerCount(realViewerCount + 779);
    } else {
      // Khi stream OFFLINE: chỉ có viewer thực (nếu có)
      setViewerCount(realViewerCount);
    }
  }, [stream?.status, realViewerCount]);

  useEffect(() => {
    const fetchRecordings = async () => {
      try {
        const data = await recordingApi.getRecentRecordings();
        setRecordings(data);
      } catch (err) {
        console.error("Failed to fetch recordings:", err);
      }
    };
    fetchRecordings();
  }, []);

  const handleSendComment = (comment: Comment) => {
    websocketService.sendComment(comment);
  };

  const handleDeleteComment = (comment: Comment) => {
    websocketService.deleteComment(comment);
  };

  const handleBlockIp = async (ipAddress: string) => {
    if (!adminUser) return;

    try {
      const response = await fetch(
        `/api/admin/blocked-ips/block?ipAddress=${ipAddress}&reason=Admin blocked&adminUsername=${adminUser.username}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        alert(`IP ${ipAddress} đã được chặn thành công!`);
      } else {
        const error = await response.json();
        alert(`Lỗi: ${error.error || "Không thể chặn IP"}`);
      }
    } catch (err) {
      alert("Không thể kết nối đến server");
    }
  };

  const handleReload = () => {
    window.location.reload();
  };

  const copyBankAccount = () => {
    navigator.clipboard.writeText("0966689355");
    alert("Đã sao chép !");
  };

  const handleLoginSuccess = (token: string, user: any) => {
    localStorage.setItem("admin_token", token);
    localStorage.setItem("admin_user", JSON.stringify(user));
    setIsAdmin(true);
    setAdminUser(user);
    setShowLoginModal(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    setIsAdmin(false);
    setAdminUser(null);
  };

  // Admin: Trigger merge for today's recordings
  const handleMergeToday = async () => {
    if (!isAdmin) return;

    const today = new Date().toISOString().split("T")[0]; // Format: yyyy-MM-dd
    const confirmMerge = window.confirm(
      `Bạn có muốn upload video ngày ${getCurrentDate()} lên hệ thống không?\n\nLưu ý: Quá trình này sẽ gộp tất cả các đoạn video đã ghi trong ngày.`
    );

    if (!confirmMerge) return;

    try {
      const result = await recordingApi.triggerMerge(today);
      if (result.success) {
        alert(
          '✅ Đang xử lý video! Video sẽ xuất hiện trong phần "Video Xem Lại" sau vài phút.'
        );
        // Refresh recordings after a delay
        setTimeout(async () => {
          const data = await recordingApi.getRecentRecordings();
          setRecordings(data);
        }, 5000);
      } else {
        alert("❌ " + result.message);
      }
    } catch (err: any) {
      alert(
        "❌ Lỗi: " + (err.response?.data?.message || "Không thể xử lý video")
      );
    }
  };

  // Admin: Delete recording by date
  const handleDeleteRecording = async (date: string) => {
    if (!isAdmin) return;

    const formattedDate = formatRecordingDate(date);
    const confirmDelete = window.confirm(
      `⚠️ Bạn có chắc muốn XÓA video ngày ${formattedDate}?\n\nHành động này không thể hoàn tác!`
    );

    if (!confirmDelete) return;

    try {
      const result = await recordingApi.deleteRecording(date);
      if (result.success) {
        alert("✅ Đã xóa video thành công!");
        // Refresh recordings
        const data = await recordingApi.getRecentRecordings();
        setRecordings(data);
      } else {
        alert("❌ " + result.message);
      }
    } catch (err: any) {
      alert(
        "❌ Lỗi: " + (err.response?.data?.message || "Không thể xóa video")
      );
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="loading-text">Đang tải...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        <div className="error-text">{error}</div>
        <button className="btn-reload" onClick={handleReload}>
          Tải lại trang
        </button>
      </div>
    );
  }

  const getCurrentDate = () => {
    const today = new Date();
    return today.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Format duration from seconds to HH:MM:SS
  const formatDuration = (seconds: number): string => {
    if (!seconds || seconds <= 0) return "00:00:00";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Format recording date from yyyy-MM-dd to dd/MM/yyyy
  const formatRecordingDate = (dateString: string): string => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <div className="viewer-page">
      {/* Header with Logo */}
      <header className="site-header">
        <div className="container">
          <div className="header-content">
            <div className="logo-section">
              <img
                src="https://res.cloudinary.com/duklfdbqf/image/upload/v1770725136/a721f7b1-7da1-4feb-9b68-6f32af38d312_estzs6.png"
                alt="Gà Chọi Chú 5"
                className="logo"
              />
              <div className="site-title">
                <h1>Gà Chọi Chú 5</h1>
                <p className="subtitle">Tinh Hoa Việt</p>
              </div>
            </div>
            <div className="header-actions">
              {isAdmin ? (
                <div className="admin-info">
                  <button
                    className="btn-blocked-ips"
                    onClick={() => setShowBlockedIpsModal(true)}
                    title="Quản lý IP đã chặn"
                  >
                    🚫 IP đã chặn
                  </button>
                  <span className="admin-badge">👑 {adminUser?.username}</span>
                  <button className="btn-logout" onClick={handleLogout}>
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <button
                  className="btn-login"
                  onClick={() => setShowLoginModal(true)}
                >
                  🔐 Đăng nhập
                </button>
              )}
              <button
                className="menu-toggle"
                onClick={() => setShowIntro(!showIntro)}
              >
                ☰
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="main-nav">
        <div className="container">
          <button onClick={() => setShowIntro(true)} className="nav-link">
            Giới thiệu
          </button>
          <button onClick={() => setShowRules(true)} className="nav-link">
            Nội Quy Xổ Gà
          </button>
        </div>
      </nav>

      <div className="container">
        {/* Live Stream Title */}
        <div className="stream-header">
          <h2 className="stream-title">
            Xổ gà Server {activeServer} trực tiếp 18h ngày {getCurrentDate()}
          </h2>

          {/* Server Selection */}
          <div className="server-selection">
            <span className="server-label">Đổi Server:</span>
            {["HD1", "HD2", "HD3", "HD4"].map((server) => (
              <button
                key={server}
                className={`server-btn ${
                  activeServer === server ? "active" : ""
                }`}
                onClick={() => setActiveServer(server)}
              >
                {server}
              </button>
            ))}
            <a href="tel:0368113370" className="phone-btn">
              📞
            </a>
          </div>
          <p className="server-hint">
            ⚠️ Nếu mạng lag hay chạy chậm bạn hãy chuyển đổi sang HD2, HD3, HD4
          </p>
        </div>

        {/* Main Content Grid */}
        <div className="main-content">
          {/* Video Player Section */}
          <div className="video-section">
            {/* Match Scoreboard Overlay */}
            {websocketService.getStompClient() && (
              <MatchScoreboard
                stompClient={websocketService.getStompClient()}
              />
            )}

            {stream && stream.status === "LIVE" ? (
              <VideoPlayer hlsUrl={stream.hlsUrl} />
            ) : (
              <div className="video-placeholder">
                <img
                  src="https://res.cloudinary.com/duklfdbqf/image/upload/v1770725127/z7512122955396_32daced5afd85f79160fc3b70904f078_zv7cw5.jpg"
                  alt="Gà Chọi Chú 5"
                  className="cover-image"
                />
                <div className="play-button-overlay">
                  <div className="play-button-circle">
                    <svg width="50" height="50" viewBox="0 0 80 80" fill="none">
                      <circle
                        cx="40"
                        cy="40"
                        r="38"
                        strokeWidth="4"
                      />
                      <path d="M32 25L55 40L32 55V25Z" fill="white" />
                    </svg>
                  </div>
                  
                </div>
              </div>
            )}

            {/* Warning Banner */}
            <div className="warning-banner">
              <span className="warning-icon">⛔</span>
              <strong>CẤM CÁ CƯỢC, CHỬI THỀ, KHOÁ NICK!</strong>
            </div>
          </div>

          {/* Chat Section */}
          <div className="chat-section">
            <ChatBox
              comments={comments}
              onSendComment={handleSendComment}
              viewerCount={viewerCount}
              isAdmin={isAdmin}
              adminUsername={adminUser?.username || null}
              onDeleteComment={handleDeleteComment}
              onBlockIp={handleBlockIp}
            />
          </div>
        </div>

        {/* Match Info Panel - Only visible for Admin */}
        {isAdmin && websocketService.getStompClient() && (
          <div className="match-info-section">
            <MatchInfoPanel stompClient={websocketService.getStompClient()} />
          </div>
        )}

        {/* Contact Section */}
        <section className="contact-section">
          <h2 className="section-title">Kết Nối Đam Mê</h2>
          <div className="contact-card">
            <div className="phone-display">
              <a href="tel:0368113370" className="phone-number">
                0368113370
              </a>
              <p className="contact-label">Hotline/Zalo liên hệ</p>
            </div>

            <div className="social-links">
              <a
                href="https://zalo.me/0368113370"
                target="_blank"
                rel="noopener noreferrer"
                className="social-btn zalo-personal"
              >
                <img
                  src="https://res.cloudinary.com/duklfdbqf/image/upload/v1765771851/zalo1_fwawgm.png"
                  alt="AE KẾT BẠN ZALO"
                  className="social-icon"
                />
              </a>

              <a
                href="https://zalo.me/g/ktbnws069"
                target="_blank"
                rel="noopener noreferrer"
                className="social-btn zalo-group"
              >
                <img
                  src="https://res.cloudinary.com/duklfdbqf/image/upload/v1765771858/zalo-vip-1_yx9lgh.png"
                  alt="NHÓM VIP ZALO"
                  className="social-icon"
                />
              </a>

              <a
                href="https://www.facebook.com/ut.phu.yen.bonsai"
                target="_blank"
                rel="noopener noreferrer"
                className="social-btn facebook"
              >
                <img
                  src="https://res.cloudinary.com/duklfdbqf/image/upload/v1765771846/fb-1_xfr0sa.png"
                  alt="AE KẾT BẠN FACEBOOK"
                  className="social-icon"
                />
              </a>
            </div>

            {/* Google Map Section */}
            {/* <div className="map-section">
              <h3 className="map-title">📍 Vị Trí Gà Chọi Chú 5</h3>
              <div className="address-display">
                <p className="address-text">
                  Địa chỉ: Ngọc Lâm, Hòa Mỹ Tây, Tây Hòa, Phú Yên
                </p>
              </div>
              <div className="map-button-container">
                <a
                  href="https://maps.app.goo.gl/M9k5SzKYhaMf2T7v5"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="map-button"
                  onClick={(e) => {
                    // Try to open in Google Maps app on mobile
                    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                    if (isMobile) {
                      // For Android: try Google Maps intent
                      if (/Android/i.test(navigator.userAgent)) {
                        const intentUrl = "https://maps.google.com/?q=Thôn+Giai+Sơn,+An+Mỹ,+Tuy+An,+Phú+Yên";
                        window.location.href = intentUrl;
                        e.preventDefault();
                      }
                      // For iOS: share.google link should work
                    }
                  }}
                >
                  <img
                    src="https://res.cloudinary.com/duklfdbqf/image/upload/v1769398033/maps_ltwngc.png"
                    alt="Mở bản đồ Google Maps"
                    className="map-button-image"
                  />
                </a>
              </div>
            </div> */}

            <div className="contact-links">
              <Link to="/gioi-thieu" className="btn-contact-link">
                ℹ️ Giới Thiệu
              </Link>
              <Link to="/lien-he" className="btn-contact-link">
                📞 Liên Hệ
              </Link>
            </div>
          </div>
        </section>

        {/* Branding Section - Thành Tích & Giải Thưởng
        <section className="branding-section">
          <h2 className="section-title">🏆 Thành Tích & Giải Thưởng</h2>
          <div className="branding-container">
            <img 
              src="/thuonghieu.jpg" 
              alt="Thành tích và giải thưởng Gà Chọi Chú 5"
              className="branding-image"
              loading="lazy"
            />
          </div>
        </section> */}

        {/* Bank Info Section */}
        <section className="bank-section">
          <div className="bank-card">
            <div className="bank-icon">💳</div>
            <h3>Thông Tin Chuyển Khoản</h3>
            <div className="bank-details">
              <p>
                <strong>AGRIBANK</strong>
              </p>
              <p>
                Tên người nhận: <strong>LUU THI THU</strong>
              </p>
              <p>
                : <strong>4610205291500</strong>
              </p>
              <button className="btn-copy" onClick={copyBankAccount}>
                📋 Sao chép STK
              </button>
            </div>
          </div>
        </section>

        {/* Rules Section */}
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-icon">⚠️</div>
            <h3>Quy định</h3>
            <ul className="rules-list">
              <li>
                <span className="check-icon">☑️</span>
                Xổ Gà Mua Bán Trên Tinh Thần Giao Lưu Vui Vẻ, Lịch Sự Trên Live
                Chat
              </li>
              <li>
                <span className="ban-icon">🚫</span>
                Không Để Số Điện Thoại, Không Cá Cược Dưới Mọi Hình Thức
              </li>
            </ul>
            <div className="rules-buttons">
              <button
                className="btn-chat"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                💬 Chat Ngay
              </button>
              <Link to="/quy-dinh" className="btn-view-rules">
                📋 Xem Đầy Đủ Quy Định
              </Link>
            </div>
          </div>
        </section>

        {/* Video Archive Section */}
        <section className="video-archive">
          <h2 className="section-title">
            <span className="play-icon">▶️</span>
            VIDEO XEM LẠI
          </h2>
          <p className="archive-desc">
            Nơi lưu trữ các video vần xổ gà chọi được quay trực tiếp hàng ngày
            18h tại Ngọc Lâm, Hòa Mỹ Tây, Tây Hòa, Phú Yên
          </p>

          {/* Admin: Upload Video Button */}
          {isAdmin && (
            <div className="admin-video-controls">
              <button
                className="btn-upload-video"
                onClick={handleMergeToday}
                title="Upload video hôm nay lên hệ thống"
              >
                📤 Upload Video Hôm Nay ({getCurrentDate()})
              </button>
            </div>
          )}

          <div className="video-grid">
            {recordings.length > 0 ? (
              recordings.map((recording) => (
                <div
                  key={recording.id}
                  className="video-card"
                  onClick={() => setSelectedVideo(recording)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="video-thumbnail">
                    <img
                      src={
                        recording.thumbnailUrl ||
                        "https://res.cloudinary.com/duklfdbqf/image/upload/v1770725127/z7512122955396_32daced5afd85f79160fc3b70904f078_zv7cw5.jpg"
                      }
                      alt={recording.title}
                    />
                    <div className="play-overlay">▶️</div>
                    {recording.durationSeconds > 0 && (
                      <span className="video-duration">
                        {formatDuration(recording.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="video-info">
                    <h4>{recording.title}</h4>
                    <p className="video-date">
                      {formatRecordingDate(recording.recordingDate)}
                    </p>
                    <span className="video-category">VIDEO XỔ GÀ XEM LẠI</span>
                    {/* Admin: Delete button */}
                    {isAdmin && (
                      <button
                        className="btn-delete-video"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRecording(recording.recordingDate);
                        }}
                        title="Xóa video này"
                      >
                        🗑️ Xóa
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="no-recordings">
                <p>
                  Chưa có video xem lại. Video sẽ được cập nhật sau mỗi buổi
                  live.
                </p>
              </div>
            )}
          </div>

          <div className="archive-note">
            <p>
              <strong>XEM LIVE HÔM NAY</strong> - Truy cập trực tiếp để xem vần
              xổ gà diễn ra lúc 18h hàng ngày
            </p>
          </div>
        </section>

        {/* Introduction Modal */}
        {showIntro && (
          <div className="modal-overlay" onClick={() => setShowIntro(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button
                className="modal-close"
                onClick={() => setShowIntro(false)}
              >
                ✕
              </button>
              <div className="modal-header">
                <img
                  src="https://res.cloudinary.com/duklfdbqf/image/upload/v1770725136/a721f7b1-7da1-4feb-9b68-6f32af38d312_estzs6.png"
                  alt="Logo"
                  className="modal-logo"
                />
                <h2>Giới thiệu</h2>
              </div>
              <div className="modal-body">
                <p>
                  • Chào mừng bạn đến với{" "}
                  <strong>Gà Chọi Chú 5</strong> (Gà Chọi Chú 5) nơi tạo ra sân chơi
                  phục vụ niềm đam mê gà đòn cho anh em 24/7. Gà Chọi Chú 5 là CLB gà chọi
                  hàng đầu tại Phú Yên.
                </p>
                <p>
                  • Tại Gà Chọi Chú 5 bạn có thể tìm hiểu về kiến
                  thức về gà đòn, hay đơn giản là thưởng thức những video xổ gà
                  trong những lúc rảnh rỗi. Gà Chọi Chú 5 sẽ đưa đến cho bạn những thông
                  tin mới nhất về giống gà đòn, kinh nghiệm chăm sóc gà, cách
                  huấn luyện gà chọi và nhiều hơn thế nữa.
                </p>
                <p>
                  • <strong>Gà Chọi Chú 5</strong> còn cung cấp con
                  giống gà đòn cho những ai đang quan tâm đến việc nuôi gà đòn.
                  Gà Chọi Chú 5 cam kết chất lượng và uy tín.
                </p>
                <div className="intro-images">
                  <img
                    src="https://res.cloudinary.com/duklfdbqf/image/upload/v1770725127/z7512122955396_32daced5afd85f79160fc3b70904f078_zv7cw5.jpg"
                    alt="CLB Gà Chọi"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rules Modal */}
        {showRules && (
          <div className="modal-overlay" onClick={() => setShowRules(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button
                className="modal-close"
                onClick={() => setShowRules(false)}
              >
                ✕
              </button>
              <div className="modal-header">
                <h2>⚠️ Nội Quy Xổ Gà</h2>
              </div>
              <div className="modal-body">
                <ul className="rules-list-detail">
                  <li>
                    <strong>☑️ Tinh thần giao lưu:</strong> Xổ Gà Mua Bán Trên
                    Tinh Thần Giao Lưu Vui Vẻ, Lịch Sự Trên Live Chat
                  </li>
                  <li>
                    <strong>🚫 Không cá cược:</strong> Không Để Số Điện Thoại,
                    Không Cá Cược Dưới Mọi Hình Thức
                  </li>
                  <li>
                    <strong>🚫 Không chửi thề:</strong> Tuyệt đối không sử dụng
                    ngôn từ thiếu văn hóa, xúc phạm người khác
                  </li>
                  <li>
                    <strong>⛔ Vi phạm sẽ bị khoá nick:</strong> Mọi hành vi vi
                    phạm sẽ bị khoá tài khoản vĩnh viễn
                  </li>
                </ul>
                <p className="disclaimer">
                  <strong>Lưu ý pháp lý:</strong> Website CLB Gà Chọi Cao Đổi
                  hoạt động với hình thức giải trí, vui lòng không cá độ dưới
                  mọi hình thức vi phạm pháp luật Việt Nam.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-col">
              <h3>Gà Chọi Chú 5</h3>
              <ul>
                <li>• Vần xổ gà trực tiếp 18h hàng ngày</li>
                <li>• Giao lưu mua bán gà chọi đi các tỉnh</li>
              </ul>
              <h3>Chuyển Khoản</h3>
              <p>🏦 agribank</p>
              <p>
                💳 STK: <strong>0368113370</strong>
              </p>
              <p>👤LUU THI THU</p>
            </div>
            <div className="footer-col">
              <h3>Liên Hệ</h3>
              <h3>
                <a href="tel:0368113370">📞 0368113370</a>
              </h3>
              <p>📍 Ngọc Lâm, Hòa Mỹ Tây, Tây Hòa, Phú Yên</p>
              <div className="social-links" style={{ marginTop: "15px" }}>
                <a
                  href="https://zalo.me/g/ktbnws069"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    color: "#0068FF",
                    textDecoration: "none",
                    marginRight: "15px",
                  }}
                >
                  <img
                    src="https://res.cloudinary.com/duklfdbqf/image/upload/v1764831133/c6f42954-ecb7-4458-bb73-9ecb6b835f8b_yt3vqs.jpg"
                    alt="Zalo"
                    style={{
                      width: "25px",
                      height: "25px",
                      borderRadius: "50%",
                      marginRight: "5px",
                    }}
                  />
                  Nhóm Zalo VIP
                </a>
                <a
                  href="https://www.facebook.com/ut.phu.yen.bonsai"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1877F2", textDecoration: "none" }}
                >
                  📘 Facebook
                </a>
              </div>
            </div>
            <div className="footer-col">
              <h3>Quy Định</h3>
              <ul>
                <li>
                  • Website Gà Chọi Chú 5 hoạt động với hình thức
                  giải trí, vui lòng không cá độ dưới mọi hình thức vi phạm pháp
                  luật Việt Nam
                </li>
                <li>
                  • Xổ Gà Mua Bán Trên Tinh Thần Giao Lưu Vui Vẻ, Lịch Sự trên
                  Live Chat
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p
              style={{ fontSize: "16px", fontWeight: "bold", color: "#ffd700" }}
            >
              🎨 Thiết kế bởi Anh Cương  - ☎️ 0387683857
            </p>
            <p>Bản quyền thuộc về Gà Chọi Chú 5 © 2025</p>
          </div>
        </div>
      </footer>

      {/* Login Modal */}
      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {/* Blocked IPs Modal */}
      {showBlockedIpsModal && (
        <BlockedIpsModal onClose={() => setShowBlockedIpsModal(false)} />
      )}

      {/* Video Replay Modal */}
      {selectedVideo && (
        <div className="modal-overlay" onClick={() => setSelectedVideo(null)}>
          <div
            className="video-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSelectedVideo(null)}
            >
              ✕
            </button>
            <div className="video-modal-header">
              <h3>{selectedVideo.title}</h3>
              <p className="video-modal-date">
                Ngày {formatRecordingDate(selectedVideo.recordingDate)} • Thời
                lượng: {formatDuration(selectedVideo.durationSeconds)}
              </p>
            </div>
            <div className="video-modal-player">
              <video
                src={selectedVideo.videoUrl}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="replay-video-player"
                onError={(e) => {
                  console.error("Video error:", e);
                  console.error("Video URL:", selectedVideo.videoUrl);
                }}
                onLoadStart={() =>
                  console.log("Video loading started:", selectedVideo.videoUrl)
                }
                onCanPlay={() => console.log("Video can play")}
              >
                <source src={selectedVideo.videoUrl} type="video/mp4" />
                Trình duyệt của bạn không hỗ trợ phát video.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Buttons */}
      <div className="floating-buttons">
        <a href="tel:0368113370" className="fab-btn fab-phone" title="Gọi Ngay">
          <span className="fab-icon">
            <img
              src="https://res.cloudinary.com/duklfdbqf/image/upload/v1764553112/yellow-phone-icon-11_pypubp.png"
              alt="Phone"
            />
          </span>
          <span className="fab-text">Gọi Ngay</span>
        </a>
        <a
          href="https://zalo.me/0368113370"
          target="_blank"
          rel="noopener noreferrer"
          className="fab-btn fab-zalo"
          title="Zalo VIP"
        >
          <span className="fab-icon">
            <img
              src="https://res.cloudinary.com/duklfdbqf/image/upload/v1765639125/zalo-icon_etabmt.png"
              alt="Zalo"
            />
          </span>
          <span className="fab-text">Zalo</span>
        </a>
      </div>
    </div>
  );
};

export default ViewerPage;
