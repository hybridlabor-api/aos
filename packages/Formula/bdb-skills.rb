class BdbSkills < Formula
  desc "Optimized Antigravity Skills for BDB DEV"
  homepage "https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills"
  url "https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills.git", branch: "main"
  version "1.0.0"

  def install
    # Install the installer script as an executable binary "bdb-skills"
    bin.install "installer.js" => "bdb-skills"
    
    # Copy the folders containing the actual skills, configs, and markdown files
    prefix.install "skills"
    prefix.install "mcp_config.json"
    prefix.install "GEMINI.md"
  end

  def caveats
    <<~EOS
      To install or update your BDB Antigravity skills, simply run:
        bdb-skills
    EOS
  end
end
