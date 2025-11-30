pipeline {
  agent any

  environment {
    IMAGE_NAME = 'meepo-replicate'
    DOCKERHUB_NAMESPACE = 'quantumteknologi'
    GIT_REPO = 'meepo-replicate'
    GIT_BRANCH = 'main'
    GIT_CREDENTIAL = 'meepo-autobot'
    ENV_FILE_CREDENTIAL = 'meepo-replicate-key'
    REGISTRY_CREDENTIAL = 'dockerhub-qtn'
    RANCHER_TOKEN_CREDENTIAL = 'meepo-rancher-secret'
    RANCHER_PROJECT_ID = 'local:p-ngpnh'
    RANCHER_URL = 'https://dev-rancher.quantumteknologi.com'
    RANCHER_NAMESPACE = 'meepo-replicate'
    RANCHER_DEPLOYMENT_NAME = 'meepo-replicate'
  }

  options {
    skipDefaultCheckout(true)
  }

  stages {

    stage('Checkout') {
      steps {
        git branch: "${env.GIT_BRANCH}", credentialsId: "${env.GIT_CREDENTIAL}", url: "https://github.com/QTN-DEV/${env.GIT_REPO}.git"
      }
    }

    stage('Set Commit Hash Tag') {
      steps {
        script {
          env.IMAGE_TAG = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
          echo "IMAGE_TAG = ${env.IMAGE_TAG}"
        }
      }
    }

    stage('Prepare .env (optional)') {
      steps {
        withCredentials([file(credentialsId: "${ENV_FILE_CREDENTIAL}", variable: 'ENV_FILE')]) {
          sh 'if [ -f "${ENV_FILE}" ]; then cp "${ENV_FILE}" .env; fi'
        }
      }
    }

    stage('Build image') {
      steps {
        sh """
          docker build -f Dockerfile -t ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} .
        """
      }
    }

    stage('Push image') {
      steps {
        withCredentials([usernamePassword(credentialsId: "${REGISTRY_CREDENTIAL}", usernameVariable: 'DH_USER', passwordVariable: 'DH_PWD')]) {
          sh '''
            echo "$DH_PWD" | docker login --username "$DH_USER" --password-stdin
            docker push ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}
            docker logout || true
          '''
        }
      }
    }

    stage('PATCH Update via Rancher') {
      steps {
        script {
          withCredentials([string(credentialsId: "${RANCHER_TOKEN_CREDENTIAL}", variable: 'RANCHER_TOKEN')]) {

            sh '''
              WORKLOAD_URL="${RANCHER_URL}/v3/project/${RANCHER_PROJECT_ID}/workloads/deployment:${RANCHER_NAMESPACE}:${RANCHER_DEPLOYMENT_NAME}"
              NEW_IMAGE="${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"

              echo "Patching workload image to: $NEW_IMAGE"

              curl -s -k -X PATCH \
                -H "Authorization: Bearer ${RANCHER_TOKEN}" \
                -H "Content-Type: application/json-patch+json" \
                "${WORKLOAD_URL}" \
                -d "[
                      {
                        \\"op\\": \\"replace\\",
                        \\"path\\": \\"/containers/0/image\\",
                        \\"value\\": \\"${NEW_IMAGE}\\"
                      }
                    ]"

              echo "Triggering redeploy..."

              curl -s -k -X POST \
                -H "Authorization: Bearer ${RANCHER_TOKEN}" \
                "${WORKLOAD_URL}?action=redeploy"

              echo "Redeploy done."
            '''
          }
        }
      }
    }

    stage('Cleanup') {
      steps {
        sh """
          docker rmi ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} || true
          docker image prune -f || true
        """
      }
    }
  }

  post {
    always {
      sh '[ -f .env ] && rm -f .env || true'
    }
  }
}
