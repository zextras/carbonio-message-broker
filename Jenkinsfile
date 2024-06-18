// SPDX-FileCopyrightText: 2023 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

pipeline {
  parameters {
    booleanParam defaultValue: false,
    description: 'Whether to upload the packages in playground repository',
    name: 'PLAYGROUND'
    booleanParam defaultValue: false,
    description: 'Whether to upload the packages in rc repository',
    name: 'RC'
  }
  options {
    skipDefaultCheckout()
    buildDiscarder(logRotator(numToKeepStr: '5'))
    timeout(time: 3, unit: 'HOURS')
  }
  agent {
    node {
      label 'base-agent-v1'
    }
  }
  environment {
    NETWORK_OPTS = '--network ci_agent'
    FAILURE_EMAIL_RECIPIENTS='smokybeans@zextras.com'
  }
  stages {
    stage('Checkout & Stash') {
      steps {
        checkout scm
        stash includes: '**', name: 'project'
      }
    }
    stage("Ubuntu packages") {
      when {
        anyOf {
          branch "main"
          expression { params.PLAYGROUND == true }
        }
      }
      parallel {
        stage('Ubuntu 20') {
          agent {
            node {
              label 'yap-agent-ubuntu-20.04-v2'
            }
          }
          steps {
            unstash 'project'
            withCredentials([usernamePassword(credentialsId: 'artifactory-jenkins-gradle-properties-splitted',
              passwordVariable: 'SECRET',
              usernameVariable: 'USERNAME')]) {
                sh 'echo "machine zextras.jfrog.io" >> auth.conf'
                sh 'echo "login $USERNAME" >> auth.conf'
                sh 'echo "password $SECRET" >> auth.conf'
                sh 'sudo mv auth.conf /etc/apt'
            }
            sh '''
              sudo echo "deb https://zextras.jfrog.io/artifactory/ubuntu-devel focal main" > zextras.list
              sudo mv zextras.list /etc/apt/sources.list.d/
              sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 52FD40243E584A21
            '''
            sh '''
              mkdir /tmp/broker
              mv * /tmp/broker
              sudo yap build ubuntu-focal /tmp/broker
            '''
            stash includes: 'artifacts/*focal*.deb', name: 'artifacts-ubuntu-focal'
          }
          post {
            failure {
              script {
                if ("main".equals(env.BRANCH_NAME)) {
                  sendFailureEmail(STAGE_NAME)
                }
              }
            }
            always {
              archiveArtifacts artifacts: 'artifacts/*focal*.deb', fingerprint: true
            }
          }
        }
        stage('Ubuntu 22') {
          agent {
            node {
              label 'yap-agent-ubuntu-22.04-v2'
            }
          }
          steps {
            unstash 'project'
            withCredentials([usernamePassword(credentialsId: 'artifactory-jenkins-gradle-properties-splitted',
              passwordVariable: 'SECRET',
              usernameVariable: 'USERNAME')]) {
                sh 'echo "machine zextras.jfrog.io" >> auth.conf'
                sh 'echo "login $USERNAME" >> auth.conf'
                sh 'echo "password $SECRET" >> auth.conf'
                sh 'sudo mv auth.conf /etc/apt'
            }
            sh '''
              sudo echo "deb https://zextras.jfrog.io/artifactory/ubuntu-devel jammy main" > zextras.list
              sudo mv zextras.list /etc/apt/sources.list.d/
              sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 52FD40243E584A21
            '''
            sh '''
              mkdir /tmp/broker
              mv * /tmp/broker
              sudo yap build ubuntu-jammy /tmp/broker
            '''
            stash includes: 'artifacts/*jammy*.deb', name: 'artifacts-ubuntu-jammy'
          }
          post {
            failure {
              script {
                if ("main".equals(env.BRANCH_NAME)) {
                  sendFailureEmail(STAGE_NAME)
                }
              }
            }
            always {
              archiveArtifacts artifacts: 'artifacts/*jammy*.deb', fingerprint: true
            }
          }
        }
      }
    }
    stage("RHEL packages") {
      when {
        anyOf {
          branch "main"
          expression { params.PLAYGROUND == true }
        }
      }
      parallel {
        stage('Rocky 8') {
          agent {
            node {
              label 'yap-agent-rocky-8-v2'
            }
          }
          steps {
            unstash 'project'
            withCredentials([usernamePassword(credentialsId: 'artifactory-jenkins-gradle-properties-splitted',
              passwordVariable: 'SECRET',
              usernameVariable: 'USERNAME')]) {
                sh 'echo "[Zextras]" > zextras.repo'
                sh 'echo "baseurl=https://$USERNAME:$SECRET@zextras.jfrog.io/artifactory/centos8-devel/" >> zextras.repo'
                sh 'echo "enabled=1" >> zextras.repo'
                sh 'echo "gpgcheck=0" >> zextras.repo'
                sh 'echo "gpgkey=https://$USERNAME:$SECRET@zextras.jfrog.io/artifactory/centos8-devel/repomd.xml.key" >> zextras.repo'
                sh 'sudo mv zextras.repo /etc/yum.repos.d/zextras.repo'
            }
            sh '''
              mkdir /tmp/broker
              mv * /tmp/broker
              sudo yap build rocky-8 /tmp/broker
            '''
            stash includes: 'artifacts/x86_64/*el8*.rpm', name: 'artifacts-rocky-8'
          }
          post {
            failure {
              script {
                if ("main".equals(env.BRANCH_NAME)) {
                  sendFailureEmail(STAGE_NAME)
                }
              }
            }
            always {
              archiveArtifacts artifacts: 'artifacts/x86_64/*el8*.rpm', fingerprint: true
            }
          }
        }
        stage('Rocky 9') {
          agent {
            node {
              label 'yap-agent-rocky-9-v2'
            }
          }
          steps {
            unstash 'project'
            withCredentials([usernamePassword(credentialsId: 'artifactory-jenkins-gradle-properties-splitted',
              passwordVariable: 'SECRET',
              usernameVariable: 'USERNAME')]) {
                sh 'echo "[Zextras]" > zextras.repo'
                sh 'echo "baseurl=https://$USERNAME:$SECRET@zextras.jfrog.io/artifactory/rhel9-devel/" >> zextras.repo'
                sh 'echo "enabled=1" >> zextras.repo'
                sh 'echo "gpgcheck=0" >> zextras.repo'
                sh 'echo "gpgkey=https://$USERNAME:$SECRET@zextras.jfrog.io/artifactory/rhel9-devel/repomd.xml.key" >> zextras.repo'
                sh 'sudo mv zextras.repo /etc/yum.repos.d/zextras.repo'
            }
            sh '''
              mkdir /tmp/broker
              mv * /tmp/broker
              sudo yap build rocky-9 /tmp/broker
            '''
            stash includes: 'artifacts/x86_64/*el9*.rpm', name: 'artifacts-rocky-9'
          }
          post {
            failure {
              script {
                if ("main".equals(env.BRANCH_NAME)) {
                  sendFailureEmail(STAGE_NAME)
                }
              }
            }
            always {
              archiveArtifacts artifacts: 'artifacts/x86_64/*el9*.rpm', fingerprint: true
            }
          }
        }
      }
    }
    stage('Upload To Playground') {
      when {
        expression { params.PLAYGROUND == true }
      }
      steps {
        unstash 'artifacts-ubuntu-focal'
        unstash 'artifacts-ubuntu-jammy'
        unstash 'artifacts-rocky-8'
        unstash 'artifacts-rocky-9'

        script {
          def server = Artifactory.server 'zextras-artifactory'
          def buildInfo
          def uploadSpec
          buildInfo = Artifactory.newBuildInfo()
          uploadSpec = '''{
            "files": [
              {
                "pattern": "artifacts/*focal*.deb",
                "target": "ubuntu-playground/pool/",
                "props": "deb.distribution=focal;deb.component=main;deb.architecture=amd64"
              },
              {
                "pattern": "artifacts/*jammy*.deb",
                "target": "ubuntu-playground/pool/",
                "props": "deb.distribution=jammy;deb.component=main;deb.architecture=amd64"
              },
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el8.x86_64.rpm",
                "target": "centos8-playground/zextras/{1}/{1}-{2}.el8.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              },
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el9.x86_64.rpm",
                "target": "rhel9-playground/zextras/{1}/{1}-{2}.el9.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              }
            ]
          }'''
          server.upload spec: uploadSpec, buildInfo: buildInfo, failNoOp: false
        }
      }
    }
    stage('Upload To Devel') {
      when {
        branch "main"
      }
      steps {
        unstash 'artifacts-ubuntu-focal'
        unstash 'artifacts-ubuntu-jammy'
        unstash 'artifacts-rocky-8'
        unstash 'artifacts-rocky-9'

        script {
          def server = Artifactory.server 'zextras-artifactory'
          def buildInfo
          def uploadSpec
          buildInfo = Artifactory.newBuildInfo()
          uploadSpec = '''{
            "files": [
              {
                "pattern": "artifacts/*focal*.deb",
                "target": "ubuntu-devel/pool/",
                "props": "deb.distribution=focal;deb.component=main;deb.architecture=amd64"
              },
              {
                "pattern": "artifacts/*jammy*.deb",
                "target": "ubuntu-devel/pool/",
                "props": "deb.distribution=jammy;deb.component=main;deb.architecture=amd64"
              },
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el8.x86_64.rpm",
                "target": "centos8-devel/zextras/{1}/{1}-{2}.el8.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              },
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el9.x86_64.rpm",
                "target": "rhel9-devel/zextras/{1}/{1}-{2}.el9.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              }
            ]
          }'''
          server.upload spec: uploadSpec, buildInfo: buildInfo, failNoOp: false
        }
      }
      post {
        failure {
          script {
            if (env.BRANCH_NAME.equals("main")) {
              sendFailureEmail(STAGE_NAME)
            }
          }
        }
      }
    }
    stage('Upload To Release') {
      when {
        allOf {
          branch "main"
          expression { params.RC == true }
        }
      }
      steps {
        unstash 'artifacts-ubuntu-focal'
        unstash 'artifacts-ubuntu-jammy'
        unstash 'artifacts-rocky-8'
        unstash 'artifacts-rocky-9'

        script {
          def server = Artifactory.server 'zextras-artifactory'
          def buildInfo
          def uploadSpec
          def config

          //ubuntu
          buildInfo = Artifactory.newBuildInfo()
          buildInfo.name += '-ubuntu'
          uploadSpec = '''{
            "files": [
              {
                "pattern": "artifacts/*focal*.deb",
                "target": "ubuntu-rc/pool/",
                "props": "deb.distribution=focal;deb.component=main;deb.architecture=amd64"
              },
              {
                "pattern": "artifacts/*jammy*.deb",
                "target": "ubuntu-rc/pool/",
                "props": "deb.distribution=jammy;deb.component=main;deb.architecture=amd64"
              }
            ]
          }'''
          server.upload spec: uploadSpec, buildInfo: buildInfo, failNoOp: false
          config = [
             'buildName'          : buildInfo.name,
             'buildNumber'        : buildInfo.number,
             'sourceRepo'         : 'ubuntu-rc',
             'targetRepo'         : 'ubuntu-release',
             'comment'            : 'Do not change anything! Just press the button',
             'status'             : 'Released',
             'includeDependencies': false,
             'copy'               : true,
             'failFast'           : true
          ]
          Artifactory.addInteractivePromotion server: server,
          promotionConfig: config,
          displayName: 'Ubuntu Promotion to Release'
          server.publishBuildInfo buildInfo

          //rhel8
          buildInfo = Artifactory.newBuildInfo()
          buildInfo.name += "-centos8"
          uploadSpec = '''{
            "files": [
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el8.x86_64.rpm",
                "target": "centos8-rc/zextras/{1}/{1}-{2}.el8.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              }
            ]
          }'''
          server.upload spec: uploadSpec, buildInfo: buildInfo, failNoOp: false
          config = [
             'buildName'          : buildInfo.name,
             'buildNumber'        : buildInfo.number,
             'sourceRepo'         : 'centos8-rc',
             'targetRepo'         : 'centos8-release',
             'comment'            : 'Do not change anything! Just press the button',
             'status'             : 'Released',
             'includeDependencies': false,
             'copy'               : true,
             'failFast'           : true
          ]
          Artifactory.addInteractivePromotion server: server,
          promotionConfig: config,
          displayName: 'RHEL8 Promotion to Release'
          server.publishBuildInfo buildInfo

          //rhel9
          buildInfo = Artifactory.newBuildInfo()
          buildInfo.name += "-rhel9"
          uploadSpec = '''{
            "files": [
              {
                "pattern": "artifacts/x86_64/(carbonio-message-broker)-(*).el9.x86_64.rpm",
                "target": "rhel9-rc/zextras/{1}/{1}-{2}.el9.x86_64.rpm",
                "props": "rpm.metadata.arch=x86_64;rpm.metadata.vendor=zextras"
              }
            ]
          }'''
          server.upload spec: uploadSpec, buildInfo: buildInfo, failNoOp: false
          config = [
             'buildName'          : buildInfo.name,
             'buildNumber'        : buildInfo.number,
             'sourceRepo'         : 'rhel9-rc',
             'targetRepo'         : 'rhel9-release',
             'comment'            : 'Do not change anything! Just press the button',
             'status'             : 'Released',
             'includeDependencies': false,
             'copy'               : true,
             'failFast'           : true
          ]
          Artifactory.addInteractivePromotion server: server,
          promotionConfig: config,
          displayName: 'RHEL9 Promotion to Release'
          server.publishBuildInfo buildInfo
        }
      }
      post {
        failure {
          script {
            if (env.BRANCH_NAME.equals("main")) {
              sendFailureEmail(STAGE_NAME)
            }
          }
        }
      }
    }
  }
}

void sendFailureEmail(String step) {
  def commitInfo =sh(
     script: 'git log -1 --pretty=tformat:\'<ul><li>Revision: %H</li><li>Title: %s</li><li>Author: %ae</li></ul>\'',
     returnStdout: true
  )
  emailext body: """\
    <b>${step.capitalize()}</b> step has failed on trunk.<br /><br />
    Last commit info: <br />
    ${commitInfo}<br /><br />
    Check the failing build at the <a href=\"${BUILD_URL}\">following link</a><br />
  """,
  subject: "[MESSAGE BROKER TRUNK FAILURE] Trunk ${step} step failure",
  to: FAILURE_EMAIL_RECIPIENTS
}
