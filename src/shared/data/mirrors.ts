// 开发镜像源数据（来自 dev-tool-box 的 mirrors.json）

export interface Mirror {
  id: string
  name: string
  url: string
  description: string
}

export interface MirrorCategory {
  id: string
  name: string
  icon: string
  configFile: string
  usage: string
  mirrors: Mirror[]
}

export const MIRRORS: MirrorCategory[] = [
  {
    id: 'pip',
    name: 'Python pip',
    icon: '🐍',
    configFile: '~/.pip/pip.conf',
    usage: 'pip install <package> -i <mirror-url>',
    mirrors: [
      { id: 'pip_aliyun', name: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple/', description: '阿里云 PyPI 镜像，国内访问速度快' },
      { id: 'pip_tsinghua', name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple/', description: '清华大学 TUNA 镜像源' },
      { id: 'pip_douban', name: '豆瓣', url: 'https://pypi.douban.com/simple/', description: '豆瓣 PyPI 镜像' },
      { id: 'pip_huawei', name: '华为云', url: 'https://repo.huaweicloud.com/repository/pypi/simple/', description: '华为云 PyPI 镜像' },
      { id: 'pip_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple/', description: '腾讯云 PyPI 镜像' },
      { id: 'pip_netease', name: '网易', url: 'https://mirrors.163.com/pypi/simple/', description: '网易开源镜像站' },
    ],
  },
  {
    id: 'npm',
    name: 'Node.js npm',
    icon: '📦',
    configFile: '~/.npmrc',
    usage: 'npm config set registry <mirror-url>',
    mirrors: [
      { id: 'npm_taobao', name: '淘宝 npmmirror', url: 'https://registry.npmmirror.com', description: '淘宝 npm 镜像（原 cnpm）' },
      { id: 'npm_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/npm/', description: '腾讯云 npm 镜像' },
      { id: 'npm_huawei', name: '华为云', url: 'https://repo.huaweicloud.com/repository/npm/', description: '华为云 npm 镜像' },
    ],
  },
  {
    id: 'go',
    name: 'Go Module',
    icon: '🔷',
    configFile: '~/.bashrc / ~/.zshrc',
    usage: 'go env -w GOPROXY=<mirror-url>',
    mirrors: [
      { id: 'go_aliyun', name: '阿里云', url: 'https://mirrors.aliyun.com/goproxy/', description: '阿里云 Go Module 镜像' },
      { id: 'go_goproxy_cn', name: 'goproxy.cn', url: 'https://goproxy.cn', description: '国内最快的 Go Module 代理' },
      { id: 'go_goproxy_io', name: 'goproxy.io', url: 'https://goproxy.io', description: '全球 Go Module 代理' },
      { id: 'go_seven', name: '7.goproxy.io', url: 'https://7.goproxy.io', description: '七牛云 Go Module 镜像' },
    ],
  },
  {
    id: 'maven',
    name: 'Java Maven',
    icon: '☕',
    configFile: '~/.m2/settings.xml',
    usage: '在 settings.xml 中配置 mirror',
    mirrors: [
      { id: 'maven_aliyun', name: '阿里云', url: 'https://maven.aliyun.com/repository/public', description: '阿里云 Maven 中央仓库镜像' },
      { id: 'maven_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/nexus/repository/maven-public/', description: '腾讯云 Maven 镜像' },
      { id: 'maven_huawei', name: '华为云', url: 'https://repo.huaweicloud.com/repository/maven/', description: '华为云 Maven 镜像' },
      { id: 'maven_netease', name: '网易', url: 'https://mirrors.163.com/maven/repository/maven-public/', description: '网易 Maven 镜像' },
    ],
  },
  {
    id: 'docker',
    name: 'Docker Registry',
    icon: '🐳',
    configFile: '/etc/docker/daemon.json',
    usage: '在 daemon.json 中配置 registry-mirrors',
    mirrors: [
      { id: 'docker_aliyun', name: '阿里云', url: 'https://<your-id>.mirror.aliyuncs.com', description: '阿里云 Docker 镜像加速器（需申请个人地址）' },
      { id: 'docker_tencent', name: '腾讯云', url: 'https://mirror.ccs.tencentyun.com', description: '腾讯云 Docker 镜像' },
      { id: 'docker_daocloud', name: 'DaoCloud', url: 'https://f1361db2.m.daocloud.io', description: 'DaoCloud Docker 加速器' },
      { id: 'docker_ustc', name: '中科大', url: 'https://docker.mirrors.ustc.edu.cn', description: '中科大 Docker 镜像' },
    ],
  },
  {
    id: 'rust',
    name: 'Rust Crates',
    icon: '🦀',
    configFile: '~/.cargo/config.toml',
    usage: 'export RUSTUP_DIST_SERVER=<mirror-url>',
    mirrors: [
      { id: 'rust_tuna', name: '清华大学', url: 'https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/', description: '清华大学 crates.io 镜像' },
      { id: 'rust_rustcc', name: 'RustCC', url: 'https://code.aliyun.com/rustcc/crates.io-index.git', description: 'RustCC 社区镜像' },
      { id: 'rust_huawei', name: '华为云', url: 'https://repo.huaweicloud.com/rust/crates.io-index/', description: '华为云 Rust 镜像' },
    ],
  },
  {
    id: 'ruby',
    name: 'Ruby Gems',
    icon: '💎',
    configFile: '~/.gemrc',
    usage: 'gem sources --add <mirror-url>',
    mirrors: [
      { id: 'ruby_tuna', name: '清华大学', url: 'https://mirrors.tuna.tsinghua.edu.cn/rubygems/', description: '清华大学 RubyGems 镜像' },
      { id: 'ruby_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/rubygems/', description: '腾讯云 RubyGems 镜像' },
    ],
  },
  {
    id: 'composer',
    name: 'PHP Composer',
    icon: '🐘',
    configFile: '~/.composer/config.json',
    usage: 'composer config -g repo.packagist composer <mirror-url>',
    mirrors: [
      { id: 'composer_aliyun', name: '阿里云', url: 'https://mirrors.aliyun.com/composer/', description: '阿里云 Composer 镜像' },
      { id: 'composer_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/composer/', description: '腾讯云 Composer 镜像' },
    ],
  },
  {
    id: 'homebrew',
    name: 'Homebrew (macOS)',
    icon: '🍺',
    configFile: '环境变量',
    usage: 'export HOMEBREW_BOTTLE_DOMAIN=<mirror-url>',
    mirrors: [
      { id: 'homebrew_tuna', name: '清华大学', url: 'https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/', description: '清华大学 Homebrew Bottles 镜像' },
      { id: 'homebrew_ustc', name: '中科大', url: 'https://mirrors.ustc.edu.cn/homebrew-bottles/', description: '中科大 Homebrew Bottles 镜像' },
    ],
  },
  {
    id: 'gradle',
    name: 'Gradle',
    icon: '⚡',
    configFile: '~/.gradle/init.gradle',
    usage: '在 init.gradle 中配置镜像仓库',
    mirrors: [
      { id: 'gradle_aliyun', name: '阿里云', url: 'https://maven.aliyun.com/repository/gradle-plugin', description: '阿里云 Gradle 插件镜像' },
      { id: 'gradle_tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/gradle/', description: '腾讯云 Gradle 镜像' },
    ],
  },
]
